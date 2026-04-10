<template>
  <ion-header>
    <ion-toolbar>
      <ion-buttons slot="start">
        <ion-button data-testid="shipment-add-product-modal-close-btn" @click="closeModal">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </ion-buttons>
      <ion-title>{{ translate("Add a product") }}</ion-title>
    </ion-toolbar>
    <ion-toolbar>
      <ion-searchbar data-testid="shipment-add-product-search-input" @ionFocus="selectSearchBarText($event)" v-model="queryString" :placeholder="translate('Search SKU or product name')" v-on:keyup.enter="queryString = $event.target.value; getProducts()" />
    </ion-toolbar>
  </ion-header>
  <ion-content data-testid="shipment-add-product-modal-content" ref="contentRef" :scroll-events="true" @ionScroll="enableScrolling()">
    <template v-if="products.length">
      <ion-list v-for="product in products" :key="product.productId" :data-testid="`shipment-add-product-row-${product.productId}`">
        <ion-item lines="none">
          <ion-thumbnail slot="start">
            <DxpShopifyImg :src="product.mainImageUrl" />
          </ion-thumbnail>
          <ion-label>
            <!-- Honouring the identifications set by the user on the settings page -->
            <h2>{{ getProductIdentificationValue(productIdentificationPref.primaryId, getProduct(product.productId)) ? getProductIdentificationValue(productIdentificationPref.primaryId, getProduct(product.productId)) : getProduct(product.productId).productName }}</h2>
            <p>{{ getProductIdentificationValue(productIdentificationPref.secondaryId, getProduct(product.productId)) }}</p>
            <p>{{ getFeatures(getProduct(product.productId).productFeatures) }}</p>
          </ion-label>
          <ion-icon v-if="isProductAvailableInShipment(product.productId)" :data-testid="`shipment-add-product-added-icon-${product.productId}`" color="success" :icon="checkmarkCircle" />
          <ion-button v-else :data-testid="`shipment-add-product-add-btn-${product.productId}`" fill="outline" @click="addToShipment(product)">{{ translate("Add to Shipment") }}</ion-button>
        </ion-item>
      </ion-list>
      <ion-infinite-scroll data-testid="shipment-add-product-infinite-scroll" @ionInfinite="loadMoreProducts($event)" threshold="100px" v-show="isScrollable" ref="infiniteScrollRef">
        <ion-infinite-scroll-content loading-spinner="crescent" :loading-text="translate('Loading')" />
      </ion-infinite-scroll>
    </template>
    <div v-else data-testid="shipment-add-product-empty-state" class="empty-state">
      <img src="../assets/images/empty-state-add-product-modal.png" alt="empty-state" />
      <p>{{ translate("Enter a SKU, or product name to search a product") }}</p>
    </div>
  </ion-content>
</template>

<script setup lang="ts">
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInfiniteScroll, IonInfiniteScrollContent, IonItem, IonLabel, IonList, IonSearchbar, IonThumbnail, IonTitle, IonToolbar, modalController } from '@ionic/vue';
import { ref, computed, onMounted } from 'vue';
import { closeOutline, checkmarkCircle } from 'ionicons/icons';
import { useProductStore } from '@/store/product'
import { useUserStore } from '@/store/user'
import { useShipmentStore } from '@/store/shipment';
import { DxpShopifyImg, translate, getProductIdentificationValue, useProductIdentificationStore } from '@hotwax/dxp-components';
import { getFeatures, showToast } from '@/utils'
import emitter from "@/event-bus"

const props = defineProps(["selectedSKU"]);

const productStore = useProductStore();
const userStore = useUserStore();
const shipmentStore = useShipmentStore();
const productIdentificationStore = useProductIdentificationStore();

const queryString = ref(props.selectedSKU ? props.selectedSKU : '');
const isScrollingEnabled = ref(false);
const contentRef = ref(null) as any;
const infiniteScrollRef = ref(null) as any;

const products = computed(() => productStore.getProducts);
const getProduct = computed(() => productStore.getProduct);
const isScrollable = computed(() => productStore.isScrollable);
const isProductAvailableInShipment = computed(() => productStore.isProductAvailableInShipment);
const facilityLocationsByFacilityId = computed(() => userStore.getFacilityLocationsByFacilityId);
const currentFacility = computed(() => userStore.getCurrentFacility);
const productIdentificationPref = computed(() => productIdentificationStore.getProductIdentificationPref);

const closeModal = () => {
  modalController.dismiss({ dismissed: true });
};

const selectSearchBarText = (event: any) => {
  event.target.getInputElement().then((element: any) => {
    element.select();
  })
};

const enableScrolling = () => {
  const parentElement = contentRef.value?.$el
  if (!parentElement) return;
  const scrollEl = parentElement.shadowRoot.querySelector("div[part='scroll']")
  if (!scrollEl) return;
  let scrollHeight = scrollEl.scrollHeight, infiniteHeight = infiniteScrollRef.value?.$el.offsetHeight || 0, scrollTop = scrollEl.scrollTop, threshold = 100, height = scrollEl.offsetHeight
  const distanceFromInfinite = scrollHeight - infiniteHeight - scrollTop - threshold - height
  if(distanceFromInfinite < 0) {
    isScrollingEnabled.value = false;
  } else {
    isScrollingEnabled.value = true;
  }
};

const getProducts = async (vSize?: any, vIndex?: any) => {
  const viewSize = vSize ? vSize : process.env.VUE_APP_VIEW_SIZE;
  const viewIndex = vIndex ? vIndex : 0;
  const payload = {
    viewSize,
    viewIndex,
    queryString: queryString.value
  }
  if (queryString.value) {
    await productStore.findProduct(payload);
  }
  else {
    showToast(translate("Enter product sku to search"))
  }
};

const loadMoreProducts = async (event: any) => {
  if(!(isScrollingEnabled.value && isScrollable.value)) {
    await event.target.complete();
  }
  getProducts(
    undefined,
    Math.ceil(products.value.length / (process.env.VUE_APP_VIEW_SIZE as any)).toString()
  ).then(async () => {
    await event.target.complete();
  });
};

const addToShipment = async (product: any) => {
  const facilityId = currentFacility.value?.facilityId;
  const facilityLocations = facilityLocationsByFacilityId.value(facilityId);
  product.locationSeqId = facilityLocations ? facilityLocations[0]?.locationSeqId : ''
  await shipmentStore.addShipmentItem(product)
};

onMounted(() => {
  if(props.selectedSKU) getProducts()
});

// Since ionViewWillEnter is not directly available in script setup without defineComponent,
// we can use it if the component is used as a page. or just use onMounted if it's a modal.
// In this case, it's a modal, so onMounted should be enough for initialization.
// If resets are needed when it "enters" view, we'd need to handle that via modal lifecycle or mitt.
</script>
