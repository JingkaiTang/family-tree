/**
 * @vitest-environment happy-dom
 *
 * MemberForm 组件集成测试
 * 覆盖：表单渲染、双向绑定、按钮事件、性别切换
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MemberForm from '@/components/member/MemberForm.vue'
import { mk } from '@/__tests__/fixtures/families'

/** 构造一个完整的 Member 供表单使用 */
function makeTestMember() {
  return mk('test-1', {
    gender: 'male',
    firstName: '靖凯',
    lastName: '唐',
    birthDate: '1990-06-15',
  })
}

describe('MemberForm', () => {
  // ========== 渲染 ==========
  it('渲染所有表单字段', () => {
    const member = makeTestMember()
    const wrapper = mount(MemberForm, {
      props: { modelValue: member },
      global: { stubs: { PhotoPicker: true } },
    })

    // 姓/名输入框
    const lastNameInput = wrapper.find('input[aria-label="姓"]')
    expect(lastNameInput.exists()).toBe(false) // 没有 aria-label

    const inputs = wrapper.findAll('input')
    // 至少包含姓、名、小名
    expect(inputs.length).toBeGreaterThanOrEqual(3)

    // 性别下拉
    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)

    // 三个按钮：删除、取消、保存
    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBe(3)
  })

  it('显示初始值', () => {
    const member = makeTestMember()
    const wrapper = mount(MemberForm, {
      props: { modelValue: member },
      global: { stubs: { PhotoPicker: true } },
    })

    // 检查姓名显示
    const inputs = wrapper.findAll('input[type="text"], input:not([type])')
    const values = inputs.map((i) => (i.element as HTMLInputElement).value)
    expect(values).toContain('唐')
    expect(values).toContain('靖凯')

    // 性别下拉
    const select = wrapper.find('select')
    expect((select.element as HTMLSelectElement).value).toBe('male')
  })

  // ========== 双向绑定 (v-model) ==========
  it('修改姓后触发 update:modelValue', async () => {
    const member = makeTestMember()
    const wrapper = mount(MemberForm, {
      props: { modelValue: member },
      global: { stubs: { PhotoPicker: true } },
    })

    const inputs = wrapper.findAll('input')
    // 第一个 input 是姓
    const lastNameInput = inputs[0]
    await lastNameInput.setValue('李')

    // 应该 emit update:modelValue
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted!.length).toBeGreaterThanOrEqual(1)
    const updatedMember = emitted![emitted!.length - 1][0] as typeof member
    expect(updatedMember.lastName).toBe('李')
  })

  it('修改名后触发 update:modelValue', async () => {
    const member = makeTestMember()
    const wrapper = mount(MemberForm, {
      props: { modelValue: member },
      global: { stubs: { PhotoPicker: true } },
    })

    const inputs = wrapper.findAll('input')
    // 第二个 input 是名
    const firstNameInput = inputs[1]
    await firstNameInput.setValue('建国')

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    const updatedMember = emitted![emitted!.length - 1][0] as typeof member
    expect(updatedMember.firstName).toBe('建国')
  })

  it('切换性别后触发 update:modelValue', async () => {
    const member = makeTestMember()
    const wrapper = mount(MemberForm, {
      props: { modelValue: member },
      global: { stubs: { PhotoPicker: true } },
    })

    const select = wrapper.find('select')
    await select.setValue('female')

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    const updatedMember = emitted![emitted!.length - 1][0] as typeof member
    expect(updatedMember.gender).toBe('female')
  })

  // ========== 按钮事件 ==========
  it('点击保存按钮触发 save 事件', async () => {
    const member = makeTestMember()
    const wrapper = mount(MemberForm, {
      props: { modelValue: member },
      global: { stubs: { PhotoPicker: true } },
    })

    // save 由表单 submit 事件触发（@submit.prevent="emit('save')"）
    const form = wrapper.find('form')
    expect(form.exists()).toBe(true)

    await form.trigger('submit')
    expect(wrapper.emitted('save')).toBeTruthy()
  })

  it('点击取消按钮触发 cancel 事件', async () => {
    const member = makeTestMember()
    const wrapper = mount(MemberForm, {
      props: { modelValue: member },
      global: { stubs: { PhotoPicker: true } },
    })

    const buttons = wrapper.findAll('button')
    // 取消是第一个普通按钮
    const cancelBtn = buttons.find((b) => b.text() === '取消')
    expect(cancelBtn?.exists()).toBe(true)

    await cancelBtn!.trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('点击删除按钮触发 delete 事件', async () => {
    const member = makeTestMember()
    const wrapper = mount(MemberForm, {
      props: { modelValue: member },
      global: { stubs: { PhotoPicker: true } },
    })

    const deleteBtn = wrapper.find('button')
    expect(deleteBtn.text()).toBe('删除此成员')

    await deleteBtn.trigger('click')
    expect(wrapper.emitted('delete')).toBeTruthy()
  })

  // ========== Props 更新 ==========
  it('外部 modelValue 变化时同步本地表单', async () => {
    const member = makeTestMember()
    const wrapper = mount(MemberForm, {
      props: { modelValue: member },
      global: { stubs: { PhotoPicker: true } },
    })

    // 外部修改 member
    const updated = { ...member, lastName: '李', firstName: '建国' }
    await wrapper.setProps({ modelValue: updated })
    await nextTick()

    const inputs = wrapper.findAll('input[type="text"], input:not([type])')
    const values = inputs.map((i) => (i.element as HTMLInputElement).value)
    expect(values).toContain('李')
    expect(values).toContain('建国')
  })
})
