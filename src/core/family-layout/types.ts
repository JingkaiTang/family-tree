import type { Member, PersistedLayoutPreferences, SiblingOrders } from '@/core/schema'

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export type LayoutDiagnosticCode =
  | 'MISSING_REFERENCE'
  | 'PARENTAGE_CYCLE'
  | 'INVALID_PRIMARY_PARTNERSHIP'
  | 'INVALID_PRIMARY_PARENTAGE'
  | 'UNROUTABLE_PRIMARY_EDGE'
  | 'CROSS_FAMILY_SEGMENT_OVERLAP'
  | 'NODE_OVERLAP'
  | 'INVALID_ROOT_DOMAIN_ASSIGNMENT'
  | 'ROOT_DOMAIN_INTRUSION'

export interface LayoutDiagnostic {
  code: LayoutDiagnosticCode
  ids: string[]
  message: string
}

export interface PersonFact { id: string; member: Member }
export interface PartnershipFact {
  id: string
  partnerIds: string[]
  status: 'current' | 'historical'
}
export interface ParentageFact {
  id: string
  parentIds: string[]
  childIds: string[]
  typeByChildId: Record<string, 'blood' | 'adopted' | 'step'>
}
export interface FamilyFacts {
  people: PersonFact[]
  partnerships: PartnershipFact[]
  parentages: ParentageFact[]
}
export interface NormalizedFactsResult {
  facts: FamilyFacts
  diagnostics: LayoutDiagnostic[]
}

export interface FamilyViewPolicy {
  primaryPartnershipByPerson: Record<string, string>
  primaryParentageByChild: Record<string, string>
  showHistoricalPartnerships: boolean
  showSecondaryParentage: boolean
  showGodparentRelations: boolean
}

export const DEFAULT_FAMILY_VIEW_POLICY: FamilyViewPolicy = {
  primaryPartnershipByPerson: {},
  primaryParentageByChild: {},
  showHistoricalPartnerships: false,
  showSecondaryParentage: false,
  showGodparentRelations: false,
}

export type LayoutPreferences = PersistedLayoutPreferences

export const EMPTY_LAYOUT_PREFERENCES: LayoutPreferences = {
  rootOrders: [],
  rowOrders: [],
  bridgeOrders: [],
  rootAccentAssignments: {},
  familyAccentAssignments: {},
}

export interface LayoutMetrics {
  gridSize: number
  cardWidth: number
  cardHeight: number
  spouseGap: number
  familyGap: number
  rootGap: number
  bridgeGap: number
  generationGap: number
  routeSubgrid: number
  cardClearance: number
}

export const DEFAULT_LAYOUT_METRICS: LayoutMetrics = {
  gridSize: 24,
  cardWidth: 168,
  cardHeight: 216,
  spouseGap: 24,
  familyGap: 72,
  rootGap: 144,
  bridgeGap: 96,
  generationGap: 360,
  routeSubgrid: 8,
  cardClearance: 12,
}

export interface LayoutRequest {
  facts: FamilyFacts
  view: FamilyViewPolicy
  preferences: LayoutPreferences
  siblingOrders?: SiblingOrders
  metrics: LayoutMetrics
  inputDiagnostics: LayoutDiagnostic[]
  previousScene?: LayoutScene
  changedIds?: string[]
  auxiliaryFocusPersonId?: string
  preferredComponentPersonId?: string
}

export interface FamilyUnit {
  id: string
  kind: 'single' | 'couple'
  memberIds: string[]
  generation: number
  width: number
  lineageAffinity: Record<string, number>
  accent: string
}
export type RootSignature = string[]
export type LayoutDomainKind = 'root' | 'pair-bridge' | 'multi-root-island'
export interface RootFamily {
  id: string
  rootUnitId: string
  seedPersonIds: string[]
  generation: number
  componentId: string
}
export interface RootDiscoveryResult {
  roots: RootFamily[]
  seedRootIdByPersonId: Record<string, string>
  previousRootIdByRootId: Record<string, string>
  suppressedIncomingPersonIds: string[]
  diagnostics: LayoutDiagnostic[]
}
export interface RootSignatureResult {
  signatureByPersonId: Record<string, RootSignature>
  signatureByUnitId: Record<string, RootSignature>
  sourceRootIdByPersonId: Partial<Record<string, string>>
  diagnostics: LayoutDiagnostic[]
}
export interface RootAccentDomainSnapshot {
  id: string
  rootIds: string[]
  personIds: string[]
  accent: string
  rect?: Rect
}
export interface RootAccentSceneSnapshot {
  rootDomains: RootAccentDomainSnapshot[]
}
export interface AssignRootAccentsInput {
  roots: RootFamily[]
  signatures: RootSignatureResult
  preferences: LayoutPreferences
  previousScene?: RootAccentSceneSnapshot
  previousRootIdByRootId?: Record<string, string>
}
export interface RootedFamilyUnit extends FamilyUnit {
  rootSignature: RootSignature
  domainId: string
  memberRootIds: Partial<Record<string, string>>
  rootAccent: string
  isRootFamily: boolean
}
export interface LayoutDomain {
  id: string
  kind: LayoutDomainKind
  componentId: string
  rootIds: string[]
  signature: RootSignature
  personIds: string[]
  unitIds: string[]
  order: number
  accent: string
}
export interface RootInteractionEdge {
  id: string
  leftRootId: string
  rightRootId: string
  weight: number
  unitIds: string[]
}
export interface BuildRootDomainsInput {
  projected: ProjectedFamily
  units: FamilyUnit[]
  roots: RootFamily[]
  signatures: RootSignatureResult
  accents: Record<string, string>
  preferences: LayoutPreferences
  siblingOrders?: SiblingOrders
  previousScene?: RootAccentSceneSnapshot
  previousRootIdByRootId?: Record<string, string>
  preferredComponentPersonId?: string
}
export interface BuildRootDomainsResult {
  domains: LayoutDomain[]
  domainIdByUnitId: Record<string, string>
  rootOrder: string[]
  interactionEdges: RootInteractionEdge[]
  diagnostics: LayoutDiagnostic[]
}
export interface DecorateRootedUnitsInput {
  baseUnits: FamilyUnit[]
  roots: RootFamily[]
  signatures: RootSignatureResult
  domains: BuildRootDomainsResult
  accents: Record<string, string>
  preferences: LayoutPreferences
}
export interface PlaceRootDomainsInput {
  units: RootedFamilyUnit[]
  parentageGroups: ParentageGroup[]
  domains: LayoutDomain[]
  preferences: LayoutPreferences
  metrics: LayoutMetrics
  previousScene?: LayoutScene
  previousRootIdByRootId?: Record<string, string>
  changedIds?: string[]
}
export interface PlacedLayoutDomain extends LayoutDomain {
  rect: Rect
  columnStart: number
  columnEnd: number
}
export interface RootLayoutModel {
  roots: RootFamily[]
  signatureByPersonId: Record<string, RootSignature>
  signatureByUnitId: Record<string, RootSignature>
  sourceRootIdByPersonId: Partial<Record<string, string>>
  domainIdByUnitId: Record<string, string>
  domains: LayoutDomain[]
  diagnostics: LayoutDiagnostic[]
}
export interface ParentageGroup {
  id: string
  sourceUnitId: string
  sourceHubId?: string
  sourceAnchorPersonId?: string
  childPersonIds: string[]
  siblingOrderId?: string
  siblingOrderPersonIds?: string[]
  hasExplicitSiblingOrder?: boolean
}
export interface AuxiliaryRelation {
  id: string
  kind: 'historical-partnership' | 'secondary-partnership' | 'secondary-parentage' | 'godparent'
  sourceId: string
  targetId: string
}
export interface ProjectedFamily {
  people: PersonFact[]
  primaryPartnerships: PartnershipFact[]
  primaryParentages: ParentageFact[]
  auxiliaryRelations: AuxiliaryRelation[]
  diagnostics: LayoutDiagnostic[]
}
export interface PlacedFamilyUnit extends RootedFamilyUnit { rect: Rect; order: number }
export interface PlacedPersonCard { id: string; unitId: string; rect: Rect; generation: number }
export interface PlacedUnionHub { id: string; unitId: string; point: Point }
export interface PlacedRow { id: string; generation: number; unitIds: string[] }
export interface SceneGeometry {
  units: PlacedFamilyUnit[]
  cards: PlacedPersonCard[]
  hubs: PlacedUnionHub[]
  rows: PlacedRow[]
  rootDomains: PlacedLayoutDomain[]
  bridgeDomains: PlacedLayoutDomain[]
  bounds: Rect
}
export interface RouteSegment {
  orientation: 'horizontal' | 'vertical' | 'bridge'
  points: Point[]
}
export interface RoutedFamilyEdge {
  id: string
  routeOwnerId: string
  kind: 'primary' | 'historical-partnership' | 'secondary-partnership' | 'secondary-parentage' | 'godparent'
  accent: string
  segments: RouteSegment[]
  gatewayIds?: string[]
}
export interface RouteGateway {
  id: string
  domainId: string
  side: 'left' | 'right' | 'top' | 'bottom'
  point: Point
  routeOwnerId: string
}
export interface RouteFamilyLanesResult {
  routes: RoutedFamilyEdge[]
  gateways: RouteGateway[]
  diagnostics: LayoutDiagnostic[]
}
export interface LayoutScene extends SceneGeometry {
  /** 当前视图实际采用的主亲子关系，供交互按布局语义识别后代子树。 */
  primaryParentageGroups?: ParentageGroup[]
  gateways: RouteGateway[]
  routes: RoutedFamilyEdge[]
  diagnostics: LayoutDiagnostic[]
}
