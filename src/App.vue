<script setup lang="ts">
import { RouterView } from 'vue-router'
import PwaStatus from '@/components/PwaStatus.vue'
import DriveStorageStatus from '@/components/DriveStorageStatus.vue'
</script>

<template>
  <RouterView />
  <PwaStatus />
  <DriveStorageStatus />
</template>
