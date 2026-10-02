<script setup lang="ts">
import { VisAxis, VisLine, VisScatter, VisXYContainer } from '@unovis/vue'

interface Point { i: number, weight: number, date: string }
const props = defineProps<{ points: Point[], unit: string }>()

const x = (d: Point) => d.i
const y = (d: Point) => d.weight
const tickX = (i: number | Date) => fmtDate(props.points[Math.round(Number(i))]?.date)
const tickY = (v: number | Date) => `${Number(v)}`
</script>

<template>
  <!-- Visual only; the set history below carries the same numbers as text. -->
  <div aria-hidden="true" class="trend">
    <VisXYContainer :data="points" :height="180" :padding="{ top: 12, right: 12 }">
      <VisLine :x="x" :y="y" color="var(--ui-primary)" :line-width="3" />
      <VisScatter :x="x" :y="y" color="var(--ui-primary)" :size="9" />
      <VisAxis type="x" :tick-format="tickX" :num-ticks="Math.min(points.length, 4)" :grid-line="false" />
      <VisAxis type="y" :tick-format="tickY" :num-ticks="4" :label="unit" />
    </VisXYContainer>
  </div>
</template>

<style scoped>
.trend {
  --vis-axis-tick-label-color: var(--ui-text-muted);
  --vis-axis-label-color: var(--ui-text-muted);
  --vis-axis-grid-color: var(--ui-border-muted);
  --vis-axis-domain-color: var(--ui-border);
  --vis-font-family: var(--font-sans);
}
</style>
