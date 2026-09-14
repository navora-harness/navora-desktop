<template>
  <div
    class="card skill-card catalog-item-card"
    :class="{ clickable: clickable }"
    @click="clickable ? emit('click') : undefined"
  >
    <div class="skill-head">
      <div class="skill-meta">
        <div class="skill-name">
          <span v-if="name" class="skill-name-text">{{ name }}</span>
          <span v-for="tag in tags" :key="tag" class="plugin-tag">{{ tag }}</span>
        </div>
        <div v-if="idLine" class="skill-id">{{ idLine }}</div>
        <div v-if="sourceLine" class="plugin-source">{{ sourceLine }}</div>
      </div>
      <div v-if="$slots.head" class="catalog-head-slot" @click.stop>
        <slot name="head" />
      </div>
    </div>
    <div class="skill-body-row">
      <div class="skill-desc">{{ description || '（无描述）' }}</div>
      <div v-if="$slots.actions" class="skill-actions" @click.stop>
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  name: string
  idLine?: string
  description?: string
  sourceLine?: string
  tags?: string[]
  clickable?: boolean
}>()

const emit = defineEmits<{
  click: []
}>()
</script>

<style scoped>
.catalog-item-card {
  border: 1px solid #e4ebf1;
  border-radius: 10px;
  background: #fafcfd;
  padding: 16px 18px;
  margin-bottom: 0;
}
.catalog-item-card.clickable {
  cursor: pointer;
}
.catalog-item-card.clickable:hover {
  border-color: #c5d4e0;
  background: #f4f8fb;
}
.skill-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.skill-meta {
  min-width: 0;
  flex: 1;
}
.skill-name {
  font-size: 0.95rem;
  font-weight: 650;
  color: #15202b;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
}
.skill-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plugin-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.4;
  flex: 0 0 auto;
  width: max-content;
  max-width: 100%;
  color: #1b4f72;
  background: #e8f1f7;
  border: 1px solid #c5d4e0;
}
.skill-id {
  margin-top: 2px;
  font-size: 0.72rem;
  color: #8a97a5;
  font-family: ui-monospace, Consolas, monospace;
}
.plugin-source {
  margin-top: 3px;
  font-size: 0.72rem;
  color: #6b7c8c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-body-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-top: 10px;
}
.skill-desc {
  flex: 1;
  min-width: 0;
  margin-top: 0;
  font-size: 0.85rem;
  color: #5d6d7e;
  line-height: 1.45;
  white-space: pre-wrap;
}
.skill-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.catalog-head-slot {
  flex-shrink: 0;
}
</style>
