import { BlobReader, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js'
import { assertFamilyIntegrity } from '@/core/familyIntegrity'
import { migrate } from '@/core/migrate'
import { FamilyData, ProjectMeta, SCHEMA_VERSION } from '@/core/schema'

const MiB = 1024 * 1024
const MAX_ARCHIVE_BYTES = 512 * MiB
const MAX_EXTRACTED_BYTES = 1024 * MiB
const MAX_ENTRY_COUNT = 5000
const MAX_INDEX_READ_BYTES = 8 * MiB
const MANIFEST_PATH = 'archive.json'
const META_PATH = 'project/meta.json'
const FAMILY_PATH = 'project/family.json'
const MEDIA_PATH = /^project\/media\/(photos|thumbs)\/([A-Za-z0-9_-]{1,128})\.webp$/
const DIRECTORIES = new Set([
  'project/', 'project/media/', 'project/media/photos/', 'project/media/thumbs/',
])

/**
 * zip.js 在逐条返回条目前会一次读取整个中央目录，条目数量检查来不及保护该分配。
 * 在 Blob.arrayBuffer() 之前限制索引/头部读取；正常文件内容仍通过 Blob 流分块读取，
 * 不受此 8 MiB 索引限制。也覆盖 ZIP64 目录和扩展字段的大块读取。
 */
class BoundedBlobReader extends BlobReader {
  override async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    if (length > MAX_INDEX_READ_BYTES) throw new Error('备份包索引过大，超过 8 MiB 限制')
    return super.readUint8Array(index, length)
  }
}

export interface ProjectBundleSource {
  meta: ProjectMeta
  family: FamilyData
  readPhoto(id: string, thumb: boolean): Promise<Blob>
}

export interface ProjectBundleReader {
  meta: ProjectMeta
  family: FamilyData
  /**
   * 单次、按需解压媒体；每个 Blob 至多 25 MiB，路径相对于项目根目录。
   * 必须完整消费后才能提交 meta/family；后续条目仍可能因 CRC 或大小错误失败。
   */
  files(): AsyncIterable<{ path: string; data: Blob }>
  /** 完成、取消或失败后均由调用方在 finally 中关闭。 */
  close(): Promise<void>
}

function entryLimit(path: string): number {
  if (path === MANIFEST_PATH || path === META_PATH) return MiB
  if (path === FAMILY_PATH) return 50 * MiB
  if (MEDIA_PATH.test(path)) return 25 * MiB
  throw new Error(`备份包包含未知文件：${path}`)
}

function validateSize(path: string, size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > entryLimit(path)) {
    throw new Error(`备份包条目过大或大小无效：${path}`)
  }
}

function validateFamily(raw: unknown): FamilyData {
  if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw)
      || !Number.isInteger(raw.schemaVersion) || Number(raw.schemaVersion) < 0) {
    throw new Error('备份包家族数据缺少有效 schemaVersion')
  }
  const parsed = FamilyData.safeParse(migrate(raw))
  if (!parsed.success) throw new Error(`备份包家族数据校验失败：${parsed.error.message}`)
  assertFamilyIntegrity(parsed.data)
  return parsed.data
}

function validateMeta(raw: unknown): ProjectMeta {
  const parsed = ProjectMeta.safeParse(raw)
  if (!parsed.success) throw new Error(`备份包项目元数据校验失败：${parsed.error.message}`)
  if (!Number.isInteger(parsed.data.schemaVersion) || parsed.data.schemaVersion < 0) {
    throw new Error('备份包项目元数据版本无效')
  }
  if (parsed.data.schemaVersion > SCHEMA_VERSION) {
    throw new Error('备份包项目版本过新，当前版本不支持')
  }
  return parsed.data
}

function photoIds(family: FamilyData): string[] {
  return [...new Set(Object.values(family.members)
    .flatMap(member => member.photoId ? [member.photoId] : []))].sort()
}

function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
}

/**
 * 输出与原生端相同的 archiveVersion=1 ZIP。顺序压缩，始终遵守输出背压，
 * 不构造整包 Blob；只包含家族数据引用的原图和缩略图。
 * 成功时关闭 destination 并等待其提交；任意失败时 abort，调用方不应再 close。
 * 使用 FileSystemFileHandle.createWritable() 可在失败时保留原有目标文件。
 */
export async function exportProjectBundleToStream(
  source: ProjectBundleSource,
  destination: WritableStream<Uint8Array>,
): Promise<void> {
  const output = destination.getWriter()
  let archiveBytes = 0
  let extractedBytes = 0
  let entryCount = 0
  const seen = new Set<string>()
  const bounded = new WritableStream<Uint8Array>({
    async write(chunk) {
      archiveBytes += chunk.byteLength
      if (archiveBytes > MAX_ARCHIVE_BYTES) throw new Error('备份包超过 512 MiB 限制')
      await output.write(chunk)
    },
  })
  const zip = new ZipWriter(bounded, {
    useWebWorkers: false,
    bufferedWrite: false,
    preventClose: true,
    unixMode: 0o100600,
  })
  async function add(path: string, data: Blob): Promise<void> {
    validateSize(path, data.size)
    if (++entryCount > MAX_ENTRY_COUNT) throw new Error('备份包文件数量超过 5000 个')
    extractedBytes += data.size
    if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error('备份包解压后超过 1 GiB 限制')
    // 便于将来在 Windows/macOS 目录恢复，拒绝仅大小写不同的同名文件。
    const normalized = path.toLowerCase()
    if (seen.has(normalized)) throw new Error(`备份包包含重复条目：${path}`)
    seen.add(normalized)
    await zip.add(path, new BlobReader(data))
  }
  try {
    // 在任何 await 前取得数据快照，导出期间编辑不能混入后续媒体列表。
    const family = validateFamily(source.family)
    const meta = { ...validateMeta(source.meta), schemaVersion: family.schemaVersion }
    const ids = photoIds(family)
    if (3 + ids.length * 2 > MAX_ENTRY_COUNT) throw new Error('备份包文件数量超过 5000 个')
    await add(MANIFEST_PATH, jsonBlob({ archiveVersion: 1 }))
    await add(META_PATH, jsonBlob(meta))
    await add(FAMILY_PATH, jsonBlob(family))
    for (const id of ids) {
      for (const thumb of [false, true]) {
        const path = `project/media/${thumb ? 'thumbs' : 'photos'}/${id}.webp`
        await add(path, await source.readPhoto(id, thumb))
      }
    }
    await zip.close(undefined, { preventClose: true })
    await output.close()
  } catch (error) {
    await output.abort(error).catch(() => undefined)
    throw error
  } finally {
    output.releaseLock()
  }
}

/**
 * BlobReader 按范围读取 ZIP；媒体延迟到 files() 解压，避免将整包加载进内存。
 * 目录、预算和项目内容立即校验；媒体 CRC 和实际解压大小在逐文件读取时校验。
 */
export async function openProjectBundle(blob: Blob): Promise<ProjectBundleReader> {
  if (blob.size > MAX_ARCHIVE_BYTES) throw new Error('备份包超过 512 MiB 限制')
  const zip = new ZipReader(new BoundedBlobReader(blob), {
    useWebWorkers: false,
    strictness: 'strict',
    checkCrc32: true,
    checkOverlappingEntry: true,
  })
  const abort = new AbortController()
  let closed = false
  let consumed = false
  let actualBytes = 0
  async function close(): Promise<void> {
    if (closed) return
    closed = true
    abort.abort(new Error('备份包已关闭'))
    await zip.close()
  }
  async function read(entry: FileEntry): Promise<Blob> {
    if (closed) throw new Error('备份包已关闭')
    const limit = entryLimit(entry.filename)
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let size = 0
    await entry.getData(new WritableStream<Uint8Array>({
      write(chunk) {
        size += chunk.byteLength
        actualBytes += chunk.byteLength
        // 在保留数据之前检查真实输出，而不信任 ZIP 中声明的解压大小。
        if (size > limit || size > entry.uncompressedSize) {
          throw new Error(`备份包条目大小不一致或过大：${entry.filename}`)
        }
        if (actualBytes > MAX_EXTRACTED_BYTES) throw new Error('备份包解压后超过 1 GiB 限制')
        chunks.push(new Uint8Array(chunk))
      },
    }), { signal: abort.signal })
    if (size !== entry.uncompressedSize) throw new Error(`备份包条目大小不一致：${entry.filename}`)
    return new Blob(chunks, { type: MEDIA_PATH.test(entry.filename) ? 'image/webp' : 'application/json' })
  }
  async function readJson(entry: FileEntry): Promise<unknown> {
    const content = await read(entry)
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await content.arrayBuffer())
      return JSON.parse(text)
    } catch {
      throw new Error(`备份包 JSON 无效：${entry.filename}`)
    }
  }
  try {
    const files = new Map<string, FileEntry>()
    const seen = new Set<string>()
    let count = 0
    let declaredBytes = 0
    for await (const entry of zip.getEntriesGenerator()) {
      if (++count > MAX_ENTRY_COUNT) throw new Error('备份包文件数量超过 5000 个')
      if (entry.symlink) throw new Error('备份包不允许包含符号链接')
      if (entry.encrypted) throw new Error('备份包不支持加密条目')
      // 合法路径全部为 ASCII；不接受 Unicode extra field 将另一个原始路径改名。
      if (entry.rawFilename.length !== entry.filename.length
          || entry.rawFilename.some((byte, index) => byte !== entry.filename.charCodeAt(index))) {
        throw new Error(`备份包文件名编码不一致：${entry.filename}`)
      }
      // 只允许普通文件/目录，拒绝设备文件等特殊 Unix 类型。
      const fileType = (entry.externalFileAttributes >>> 16) & 0o170000
      if (fileType && fileType !== (entry.directory ? 0o040000 : 0o100000)) {
        throw new Error(`备份包包含不支持的文件类型：${entry.filename}`)
      }
      const normalized = entry.filename.toLowerCase().replace(/\/$/, '')
      if (seen.has(normalized)) throw new Error(`备份包包含重复条目：${entry.filename}`)
      seen.add(normalized)
      if (entry.directory) {
        if (!DIRECTORIES.has(entry.filename) || entry.uncompressedSize !== 0) {
          throw new Error(`备份包包含未知目录：${entry.filename}`)
        }
        continue
      }
      validateSize(entry.filename, entry.uncompressedSize)
      declaredBytes += entry.uncompressedSize
      if (declaredBytes > MAX_EXTRACTED_BYTES) throw new Error('备份包解压后超过 1 GiB 限制')
      files.set(entry.filename, entry)
    }
    function required(path: string): FileEntry {
      const entry = files.get(path)
      if (!entry) throw new Error(`备份包缺少文件：${path}`)
      return entry
    }
    const manifest = await readJson(required(MANIFEST_PATH))
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
        || Object.keys(manifest).length !== 1
        || !('archiveVersion' in manifest) || manifest.archiveVersion !== 1) {
      throw new Error('不支持的备份包版本或清单格式')
    }
    const rawMeta = validateMeta(await readJson(required(META_PATH)))
    const family = validateFamily(await readJson(required(FAMILY_PATH)))
    const meta = { ...rawMeta, schemaVersion: family.schemaVersion }
    for (const id of photoIds(family)) {
      required(`project/media/photos/${id}.webp`)
      required(`project/media/thumbs/${id}.webp`)
    }
    return {
      meta,
      family,
      async *files() {
        if (closed) throw new Error('备份包已关闭')
        if (consumed) throw new Error('备份包媒体只能读取一次')
        consumed = true
        for (const [path, entry] of files) {
          if (MEDIA_PATH.test(path)) {
            yield { path: path.slice('project/'.length), data: await read(entry) }
          }
        }
      },
      close,
    }
  } catch (error) {
    await close().catch(() => undefined)
    throw error
  }
}
