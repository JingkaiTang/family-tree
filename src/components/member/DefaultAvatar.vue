<script setup lang="ts">
import { computed } from 'vue'
import type { Gender } from '@/core/schema'
import type { DefaultAvatarAgeBand } from '@/core/defaultAvatar'

const props = defineProps<{
  gender: Gender
  ageBand: DefaultAvatarAgeBand
}>()

const palette = computed(() => {
  if (props.gender === 'male') {
    return { background: '#dceef7', decoration: '#b9dce9', silhouette: '#39738f', hair: '#28566d' }
  }
  if (props.gender === 'female') {
    return { background: '#f8e4eb', decoration: '#efc5d3', silhouette: '#a45170', hair: '#74384f' }
  }
  return { background: '#e8edf2', decoration: '#d1dae3', silhouette: '#667386', hair: '#465263' }
})

const geometry = computed(() => {
  switch (props.ageBand) {
    case 'child':
      return { headX: 84, headY: 82, headRx: 27, headRy: 31, shoulderLeft: 34, shoulderRight: 134, shoulderTop: 134 }
    case 'young':
      return { headX: 84, headY: 76, headRx: 30, headRy: 35, shoulderLeft: 20, shoulderRight: 148, shoulderTop: 126 }
    case 'senior':
      return { headX: 84, headY: 79, headRx: 32, headRy: 36, shoulderLeft: 24, shoulderRight: 144, shoulderTop: 132 }
    default:
      return { headX: 84, headY: 77, headRx: 31, headRy: 36, shoulderLeft: 18, shoulderRight: 150, shoulderTop: 128 }
  }
})

const shoulderPath = computed(() => {
  const g = geometry.value
  return [
    `M ${g.shoulderLeft} 216`,
    `L ${g.shoulderLeft} ${g.shoulderTop + 30}`,
    `C ${g.shoulderLeft} ${g.shoulderTop + 8}, ${g.headX - 27} ${g.shoulderTop}, ${g.headX - 17} ${g.shoulderTop - 5}`,
    `L ${g.headX + 17} ${g.shoulderTop - 5}`,
    `C ${g.headX + 27} ${g.shoulderTop}, ${g.shoulderRight} ${g.shoulderTop + 8}, ${g.shoulderRight} ${g.shoulderTop + 30}`,
    `L ${g.shoulderRight} 216 Z`,
  ].join(' ')
})

const genderSymbol = computed(() => {
  if (props.gender === 'female') return '♀'
  if (props.gender === 'male') return '♂'
  return '·'
})

const ariaLabel = computed(() => {
  const gender = props.gender === 'female' ? '女性' : props.gender === 'male' ? '男性' : '中性'
  const age = {
    child: '儿童',
    young: '青年',
    adult: '成年',
    senior: '老年',
  }[props.ageBand]
  return `${age}${gender}默认头像`
})
</script>

<template>
  <svg
    viewBox="0 0 168 216"
    class="h-full w-full"
    :aria-label="ariaLabel"
    role="img"
    :data-age-band="ageBand"
    :data-gender="gender"
  >
    <rect width="168" height="216" :fill="palette.background" />
    <circle cx="23" cy="27" r="38" :fill="palette.decoration" opacity="0.7" />
    <circle cx="157" cy="88" r="54" :fill="palette.decoration" opacity="0.55" />

    <!-- 长发轮廓先置于头部之后；中性使用较短的圆润发型。 -->
    <ellipse
      v-if="gender === 'female'"
      :cx="geometry.headX"
      :cy="geometry.headY + 8"
      :rx="geometry.headRx + 10"
      :ry="geometry.headRy + (ageBand === 'child' ? 12 : 21)"
      :fill="palette.hair"
    />
    <ellipse
      v-else-if="gender === 'other'"
      :cx="geometry.headX"
      :cy="geometry.headY + 3"
      :rx="geometry.headRx + 7"
      :ry="geometry.headRy + 9"
      :fill="palette.hair"
    />

    <path :d="shoulderPath" :fill="palette.silhouette" />
    <rect
      :x="geometry.headX - 12"
      :y="geometry.headY + geometry.headRy - 4"
      width="24"
      height="31"
      rx="9"
      :fill="palette.silhouette"
    />
    <ellipse
      :cx="geometry.headX"
      :cy="geometry.headY"
      :rx="geometry.headRx"
      :ry="geometry.headRy"
      :fill="palette.silhouette"
    />

    <!-- 短发和银发只改变剪影边缘，不绘制具体五官。 -->
    <path
      v-if="gender === 'male'"
      :d="`M ${geometry.headX - geometry.headRx + 2} ${geometry.headY - 13}
        Q ${geometry.headX - 13} ${geometry.headY - geometry.headRy - 9}, ${geometry.headX + 4} ${geometry.headY - geometry.headRy - 4}
        Q ${geometry.headX + geometry.headRx - 2} ${geometry.headY - geometry.headRy}, ${geometry.headX + geometry.headRx - 1} ${geometry.headY - 8}
        Q ${geometry.headX + 7} ${geometry.headY - 21}, ${geometry.headX - geometry.headRx + 2} ${geometry.headY - 13} Z`"
      :fill="palette.hair"
    />
    <path
      v-if="ageBand === 'senior'"
      :d="`M ${geometry.headX - geometry.headRx + 7} ${geometry.headY - 20}
        Q ${geometry.headX} ${geometry.headY - geometry.headRy - 8}, ${geometry.headX + geometry.headRx - 7} ${geometry.headY - 18}
        Q ${geometry.headX + 11} ${geometry.headY - 27}, ${geometry.headX - geometry.headRx + 7} ${geometry.headY - 20} Z`"
      :fill="palette.background"
      opacity="0.9"
    />
    <g v-if="ageBand === 'senior'" fill="none" :stroke="palette.background" stroke-width="3" opacity="0.75">
      <circle :cx="geometry.headX - 11" :cy="geometry.headY + 1" r="8" />
      <circle :cx="geometry.headX + 11" :cy="geometry.headY + 1" r="8" />
      <path :d="`M ${geometry.headX - 3} ${geometry.headY + 1} H ${geometry.headX + 3}`" />
    </g>

    <circle cx="143" cy="25" r="15" fill="white" opacity="0.72" />
    <text
      x="143"
      y="31"
      text-anchor="middle"
      :fill="palette.silhouette"
      font-size="18"
      font-family="system-ui, sans-serif"
      font-weight="700"
    >{{ genderSymbol }}</text>
  </svg>
</template>
