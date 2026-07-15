import { describe, expect, it } from 'vitest'
import { decorateRootedUnits } from './decorateRootedUnits'
import {
  preparedRootDomains,
  sameRootCousinMarriageFixture,
  twoRootMarriageFixture,
} from './rootLayoutTestHelpers'

describe('decorateRootedUnits', () => {
  it('orders a cross-root couple by source root position', () => {
    const prepared = preparedRootDomains(twoRootMarriageFixture(), {
      rootOrder: ['root:b0+b0-spouse', 'root:a0+a0-spouse'],
    })
    const units = decorateRootedUnits(prepared)

    expect(
      units.find(unit => (
        unit.id === 'unit:partnership:current:a2+b1'
      ))?.memberIds,
    ).toEqual(['b1', 'a2'])
  })

  it('keeps a same-root couple stable and marks only the actual root family', () => {
    const units = decorateRootedUnits(
      preparedRootDomains(sameRootCousinMarriageFixture()),
    )

    expect(
      units.find(unit => (
        unit.id === 'unit:partnership:current:left-cousin+right-cousin'
      ))?.memberIds,
    ).toEqual(['left-cousin', 'right-cousin'])
    expect(units.filter(unit => unit.isRootFamily).map(unit => unit.id))
      .toEqual(['unit:partnership:current:a0+a0-spouse'])
  })
})
