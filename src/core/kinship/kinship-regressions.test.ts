import { describe, expect, it } from 'vitest'
import { addParent, addSibling, addSpouse, mk } from '@/__tests__/fixtures/families'
import { getKinship } from './index'

describe('getKinship — 审核回归', () => {
  it('未录共同父母时，仍识别哥哥的妻子', () => {
    const members = {
      self: mk('self', { gender: 'male', birthDate: '1990-01-01' }),
      brother: mk('brother', { gender: 'male', birthDate: '1980-01-01' }),
      wife: mk('wife', { gender: 'female' }),
    }
    addSibling(members.self, members.brother)
    addSpouse(members.brother, members.wife)

    expect(getKinship('self', 'wife', members)).toBe('嫂子')
  })

  it('未录共同父母时，兄弟的子女与叔伯双向称呼成立且不补造父母', () => {
    const members = {
      self: mk('self', { gender: 'male', birthDate: '1990-01-01' }),
      brother: mk('brother', { gender: 'male', birthDate: '1980-01-01' }),
      son: mk('son', { gender: 'male' }),
      daughter: mk('daughter', { gender: 'female' }),
    }
    addSibling(members.self, members.brother)
    addParent(members.son, members.brother)
    addParent(members.daughter, members.brother)
    const before = structuredClone(members)

    expect(getKinship('self', 'son', members)).toBe('侄子')
    expect(getKinship('self', 'daughter', members)).toBe('侄女')
    expect(getKinship('son', 'self', members)).toBe('叔叔')
    expect(members).toEqual(before)
  })

  it('奶奶兄弟的儿子是父亲的表兄，不能因目标支系为男性误判为堂伯', () => {
    const members = {
      self: mk('self', { gender: 'male' }),
      father: mk('father', { gender: 'male', birthDate: '1970-01-01' }),
      grandmother: mk('grandmother', { gender: 'female' }),
      ancestor: mk('ancestor', { gender: 'male' }),
      granduncle: mk('granduncle', { gender: 'male' }),
      uncle: mk('uncle', { gender: 'male', birthDate: '1960-01-01' }),
    }
    addParent(members.self, members.father)
    addParent(members.father, members.grandmother)
    addParent(members.grandmother, members.ancestor)
    addParent(members.granduncle, members.ancestor)
    addParent(members.uncle, members.granduncle)

    expect(getKinship('self', 'uncle', members)).toBe('表伯')
    expect(getKinship('uncle', 'self', members)).toBe('表侄')
  })

  it.each([
    ['male', 'female', '妯娌'],
    ['female', 'male', '连襟'],
  ] as const)('未录父母的 %s 兄弟姐妹，其 %s 配偶互称 %s', (siblingGender, partnerGender, expected) => {
    const members = {
      a: mk('a', { gender: siblingGender }),
      b: mk('b', { gender: siblingGender }),
      aPartner: mk('aPartner', { gender: partnerGender }),
      bPartner: mk('bPartner', { gender: partnerGender }),
    }
    addSibling(members.a, members.b)
    addSpouse(members.a, members.aPartner)
    addSpouse(members.b, members.bPartner)

    expect(getKinship('aPartner', 'bPartner', members)).toBe(expected)
    expect(getKinship('bPartner', 'aPartner', members)).toBe(expected)
  })

  it('配偶的兄弟有生日时区分大舅子和小舅子，共享顺序优先于生日', () => {
    const members = {
      self: mk('self', { gender: 'male' }),
      wife: mk('wife', { gender: 'female', birthDate: '1990-01-01' }),
      brother: mk('brother', { gender: 'male', birthDate: '1980-01-01' }),
    }
    addSpouse(members.self, members.wife)
    addSibling(members.wife, members.brother)

    expect(getKinship('self', 'brother', members)).toBe('大舅子')
    expect(getKinship('self', 'brother', members, {}, { siblings: ['wife', 'brother'] })).toBe('小舅子')
  })

  it('gender other 的父母、子女及干亲使用中性称谓', () => {
    const members = {
      self: mk('self'),
      parent: mk('parent'),
      child: mk('child'),
      godparent: mk('godparent'),
      godchild: mk('godchild'),
      father: mk('father', { gender: 'male' }),
      mother: mk('mother', { gender: 'female' }),
    }
    addParent(members.self, members.parent)
    addParent(members.child, members.self)
    addParent(members.self, members.father)
    addParent(members.self, members.mother)
    members.self.godparents.push({ id: 'godparent', type: 'godparent' })
    members.godparent.godchildren.push({ id: 'self', type: 'godchild' })
    members.self.godchildren.push({ id: 'godchild', type: 'godchild' })
    members.godchild.godparents.push({ id: 'self', type: 'godparent' })

    expect(getKinship('self', 'parent', members)).toBe('父母')
    expect(getKinship('self', 'child', members)).toBe('子女')
    expect(getKinship('self', 'godparent', members)).toBe('干亲长辈')
    expect(getKinship('self', 'godchild', members)).toBe('干亲子女')
    expect(getKinship('self', 'father', members)).toBe('父亲')
    expect(getKinship('self', 'mother', members)).toBe('母亲')
  })

  it('中间成员为 other 时，祖孙和侄甥使用可解释关系链，已知兄弟称呼保留', () => {
    const members = {
      self: mk('self', { gender: 'male' }),
      parent: mk('parent'),
      grandparent: mk('grandparent', { gender: 'male' }),
      brother: mk('brother', { gender: 'male' }),
      sibling: mk('sibling'),
      niece: mk('niece', { gender: 'female' }),
      grandchild: mk('grandchild'),
    }
    addParent(members.self, members.parent)
    addParent(members.parent, members.grandparent)
    addParent(members.brother, members.parent)
    addSibling(members.self, members.sibling)
    addParent(members.niece, members.sibling)
    addParent(members.grandchild, members.self)

    expect(getKinship('self', 'grandparent', members)).toBe('父母的父亲')
    expect(getKinship('grandparent', 'self', members)).toBe('子女的儿子')
    expect(getKinship('parent', 'grandchild', members)).toBe('儿子的子女')
    expect(getKinship('self', 'sibling', members)).toBe('兄弟姐妹')
    expect(getKinship('self', 'niece', members)).toBe('兄弟姐妹的女儿')
    expect(getKinship('self', 'brother', members)).toBe('兄弟')
  })

  it('亲属配偶为 other 使用伴侣，配偶为 other 不默认进入妻家称谓', () => {
    const members = {
      self: mk('self', { gender: 'male', birthDate: '1990-01-01' }),
      brother: mk('brother', { gender: 'male', birthDate: '1980-01-01' }),
      partner: mk('partner'),
      father: mk('father', { gender: 'male' }),
      sibling: mk('sibling'),
    }
    addSibling(members.self, members.brother)
    addSpouse(members.brother, members.partner)
    addParent(members.partner, members.father)
    addSibling(members.partner, members.sibling)

    expect(getKinship('self', 'partner', members)).toBe('哥哥的伴侣')
    expect(getKinship('brother', 'father', members)).toBe('伴侣的父亲')
    expect(getKinship('brother', 'sibling', members)).toBe('伴侣的兄弟姐妹')
    expect(getKinship('partner', 'self', members)).toBe('小叔子')
  })

  it.each([
    ['male', 'male', '大伯子', '小叔子', '大伯子/小叔子'],
    ['male', 'female', '大姑子', '小姑子', '大姑子/小姑子'],
    ['female', 'male', '大舅子', '小舅子', '大舅子/小舅子'],
    ['female', 'female', '大姨子', '小姨子', '大姨子/小姨子'],
  ] as const)('%s 配偶的 %s 手足：生日、排序及未知长幼', (spouseGender, siblingGender, older, younger, unknown) => {
    const members = {
      self: mk('self'),
      spouse: mk('spouse', { gender: spouseGender, birthDate: '1990-01-01' }),
      sibling: mk('sibling', { gender: siblingGender, birthDate: '1980-01-01' }),
      parent: mk('parent'),
    }
    addSpouse(members.self, members.spouse)
    addParent(members.spouse, members.parent)
    addParent(members.sibling, members.parent)

    expect(getKinship('self', 'sibling', members)).toBe(older)
    expect(getKinship('self', 'sibling', members, {}, { siblings: ['spouse', 'sibling'] })).toBe(younger)
    members.sibling.birthDate = undefined
    expect(getKinship('self', 'sibling', members)).toBe(unknown)
    expect(getKinship('self', 'sibling', members, { self: { sibling: '自定义称呼' } })).toBe('自定义称呼')
  })

  it.each([
    ['male', 'male', 'male', '堂伯'],
    ['male', 'female', 'male', '表伯'],
    ['male', 'male', 'female', '表伯'],
    ['female', 'male', 'male', '堂舅'],
    ['female', 'female', 'male', '表舅'],
    ['female', 'male', 'female', '表舅'],
  ] as const)('%s 父母两侧支系 %s/%s 判为 %s', (parentGender, grandparentGender, branchGender, expected) => {
    const members = {
      self: mk('self', { gender: 'male' }),
      parent: mk('parent', { gender: parentGender, birthDate: '1970-01-01' }),
      grandparent: mk('grandparent', { gender: grandparentGender }),
      branch: mk('branch', { gender: branchGender }),
      uncle: mk('uncle', { gender: 'male', birthDate: '1960-01-01' }),
    }
    addParent(members.self, members.parent)
    addParent(members.parent, members.grandparent)
    addSibling(members.grandparent, members.branch)
    addParent(members.uncle, members.branch)

    expect(getKinship('self', 'uncle', members)).toBe(expected)
  })

  it.each([
    ['adopted', '养父母', '养子女'],
    ['step', '继父母', '继子女'],
  ] as const)('%s 关系为 other 时保留关系类型', (type, parentLabel, childLabel) => {
    const members = { parent: mk('parent'), child: mk('child') }
    addParent(members.child, members.parent, type)

    expect(getKinship('child', 'parent', members)).toBe(parentLabel)
    expect(getKinship('parent', 'child', members)).toBe(childLabel)
  })

  it('未录父母时，姐妹子女与舅舅的双向关系成立', () => {
    const members = {
      self: mk('self', { gender: 'male' }),
      sister: mk('sister', { gender: 'female' }),
      niece: mk('niece', { gender: 'female' }),
    }
    addSibling(members.self, members.sister)
    addParent(members.niece, members.sister)

    expect(getKinship('self', 'niece', members)).toBe('外甥女')
    expect(getKinship('niece', 'self', members)).toBe('舅舅')
  })

  it.each([
    ['male', '继子'],
    ['female', '继女'],
    ['other', '继子女'],
  ] as const)('other 配偶的 %s 子女称为 %s，不依赖配偶性别', (gender, expected) => {
    for (const type of ['blood', 'adopted', 'step'] as const) {
      const members = {
        self: mk('self', { gender: 'male' }),
        partner: mk('partner'),
        child: mk('child', { gender }),
      }
      addSpouse(members.self, members.partner)
      addParent(members.child, members.partner, type)

      expect(getKinship('self', 'child', members)).toBe(expected)
      members.partner.gender = 'female'
      expect(getKinship('self', 'child', members)).toBe(expected)
    }
  })
})
