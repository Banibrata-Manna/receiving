<template>
  <ion-item :data-testid="`return-list-item-row-${returnShipment.shipmentId}`" button @click="viewReturn()">
    <ion-label>
      <h2>{{ returnShipment.trackingCode ? returnShipment.trackingCode : returnShipment.externalId ? returnShipment.externalId : returnShipment.shipmentId }}</h2>
      <p>{{ returnShipment.shopifyOrderName ? returnShipment.shopifyOrderName : returnShipment.hcOrderId }}</p>
    </ion-label>
    <ion-badge :data-testid="`return-list-item-status-badge-${returnShipment.shipmentId}`" :color="statusColorMapping[returnShipment.statusDesc] ? statusColorMapping[returnShipment.statusDesc] : 'medium'" slot="end">{{ returnShipment.statusDesc }}</ion-badge>
  </ion-item>
</template>

<script setup lang="ts">
import { IonBadge, IonItem, IonLabel } from '@ionic/vue';
import { useRouter } from 'vue-router';

const props = defineProps(["returnShipment"]);
const router = useRouter();

const statusColorMapping = {
  'Received': 'success',
  'Approved': 'tertiary',
  'Cancelled': 'danger',
  'Shipped': 'medium',
  'Created': 'medium'
} as any;

const viewReturn = () => {
  router.push({ path: `/return/${props.returnShipment.shipmentId}` });
};
</script>
