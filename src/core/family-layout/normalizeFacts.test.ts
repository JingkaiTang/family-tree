import { describe, expect, it } from 'vitest'
import { createEmptyFamily } from '@/core/schema'
import { familyData, linkParent, linkSpouse, member } from './testHelpers'
import { normalizeFacts } from './normalizeFacts'

describe('normalizeFacts', () => {
  it('creates deterministic current partnership and parentage facts', () => {
    const dad = member('dad')
    const mom = member('mom')
    const kid = member('kid')
    linkSpouse(dad, mom)
    linkParent(kid, dad)
    linkParent(kid, mom)

    const result = normalizeFacts(familyData([kid, mom, dad]))

    expect(result.facts.partnerships).toEqual([{
      id: 'partnership:current:dad+mom',
      partnerIds: ['dad', 'mom'],
      status: 'current',
    }])
    expect(result.facts.parentages).toEqual([{
      id: 'parentage:dad+mom',
      parentIds: ['dad', 'mom'],
      childIds: ['kid'],
      typeByChildId: { kid: 'blood' },
    }])
    expect(result.diagnostics).toEqual([])
  })

  it('keeps valid people and reports missing references', () => {
    const data = createEmptyFamily()
    data.members.kid = member('kid', {
      parents: [{ id: 'missing-parent', type: 'blood' }],
    })

    const result = normalizeFacts(data)

    expect(result.facts.people.map(person => person.id)).toEqual(['kid'])
    expect(result.facts.parentages).toEqual([])
    expect(result.diagnostics).toEqual([{
      code: 'MISSING_REFERENCE',
      ids: ['kid', 'missing-parent'],
      message: 'kid references missing member missing-parent',
    }])
  })
})
