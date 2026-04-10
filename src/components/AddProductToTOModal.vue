<template>
  <ion-header>
    <ion-toolbar>
      <ion-buttons slot="start">
        <ion-button data-testid="transfer-order-add-product-modal-close-btn" @click="closeModal">
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </ion-buttons>
      <ion-title>{{ translate("Add a product") }}</ion-title>
    </ion-toolbar>
    <ion-toolbar>
      <ion-searchbar data-testid="transfer-order-add-product-search-input" @ionFocus="selectSearchBarText($event)" v-model="queryString" :placeholder="translate('Search SKU or product name')" @keyup.enter="handleSearch" @ionInput='handleInput'/>
    </ion-toolbar>
  </ion-header>
  <ion-content data-testid="transfer-order-add-product-modal-content" ref="contentRef" :scroll-events="true" @ionScroll="enableScrolling()">
    <template v-if="products.length">
      <ion-list v-for="product in products" :key="product.productId" :data-testid="`transfer-order-add-product-row-${product.productId}`">
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
          <ion-icon v-if="isProductAvailableInOrder(product.productId)" :data-testid="`transfer-order-add-product-added-icon-${product.productId}`" color="success" :icon="checkmarkCircle" />
          <ion-button v-else :data-testid="`transfer-order-add-product-add-btn-${product.productId}`" fill="outline" @click="addtoOrder(product)">{{ translate("Add to Transfer Order") }}</ion-button>
        </ion-item>
      </ion-list>

      <ion-infinite-scroll data-testid="transfer-order-add-product-infinite-scroll" @ionInfinite="loadMoreProducts($event)" threshold="100px" v-show="isScrollable" ref="infiniteScrollRef">
        <ion-infinite-scroll-content loading-spinner="crescent" :loading-text="translate('Loading')" />
      </ion-infinite-scroll>
    </template>
    <div v-else-if="queryString && isSearching && !products.length" data-testid="transfer-order-add-product-search-empty-state" class="empty-state">
      <p>{{ translate("No products found") }}</p>
    </div>
    <div v-else data-testid="transfer-order-add-product-empty-state" class="empty-state">
      <img src="../assets/images/empty-state-add-product-modal.png" alt="empty-state" />
      <p>{{ translate("Enter a SKU, or product name to search a product") }}</p>
    </div>
  </ion-content>
</template>

<script setup lang="ts">
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInfiniteScroll, IonInfiniteScrollContent, IonItem, IonLabel, IonList, IonSearchbar, IonThumbnail, IonTitle, IonToolbar, modalController, onIonViewWillEnter } from '@ionic/vue';
import { ref, computed, onMounted } from 'vue';
import { closeOutline, checkmarkCircle } from 'ionicons/icons';
import { useProductStore } from "@/store/product";
import { useTransferOrderStore } from "@/store/transferorder";
import { useUserStore as useDxpUserStore, DxpShopifyImg, translate, getProductIdentificationValue, useProductIdentificationStore } from '@hotwax/dxp-components';
import { useUserStore } from "@/store/user";
import { getFeatures, showToast } from '@/utils'

const props = defineProps(["selectedSKU"]);

const productStore = useProductStore();
const transferOrderStore = useTransferOrderStore();
const userStore = useUserStore();
const dxpUserStore = useDxpUserStore();
const productIdentificationStore = useProductIdentificationStore();

const queryString = ref(props.selectedSKU ? props.selectedSKU : '');
const isScrollingEnabled = ref(false);
const isSearching = ref(false);
const contentRef = ref(null as any);
const infiniteScrollRef = ref(null as any);

const products = computed(() => productStore.getProducts);
const getProduct = computed(() => productStore.getProduct);
const isScrollable = computed(() => productStore.isScrollable);
const isProductAvailableInOrder = computed(() => transferOrderStore.isProductAvailableInOrder);
const facilityLocationsByFacilityId = computed(() => userStore.getFacilityLocationsByFacilityId);
const currentFacility = computed(() => userStore.getCurrentFacility);
const productIdentificationPref = computed(() => productIdentificationStore.getProductIdentificationPref);

onMounted(() => {
  if (props.selectedSKU) handleSearch()
});

onIonViewWillEnter(() => {
  isScrollingEnabled.value = false;
});

const getProducts = async (vSize?: any, vIndex?: any) => {
  const viewSize = vSize ? vSize : process.env.VUE_APP_VIEW_SIZE;
  const viewIndex = vIndex ? vIndex : 0;
  const payload = {
    viewSize,
    viewIndex,
    queryString: queryString.value.trim()
  }
  await productStore.findProduct(payload);
};

const handleSearch = async () => {    
  if (!queryString.value.trim()){
    showToast(translate("Enter product sku to search"))
    isSearching.value = false
    productStore.clearSearchedProducts()
    return
  }
  await getProducts()
  isSearching.value = true
};

const handleInput = async () => {
  if (!queryString.value.trim()){
    isSearching.value = false
    productStore.clearSearchedProducts()
  }
};

const enableScrolling = () => {
  const parentElement = contentRef.value?.$el
  if (!parentElement) return;
  const scrollEl = parentElement.shadowRoot.querySelector("div[part='scroll']")
  let scrollHeight = scrollEl.scrollHeight, infiniteHeight = infiniteScrollRef.value?.$el.offsetHeight, scrollTop = scrollEl.scrollTop, threshold = 100, height = scrollEl.offsetHeight
  const distanceFromInfinite = scrollHeight - infiniteHeight - scrollTop - threshold - height
  if(distanceFromInfinite < 0) {
    isScrollingEnabled.value = false;
  } else {
    isScrollingEnabled.value = true;
  }
};

const loadMoreProducts = async (event: any) => {
   // Added this check here as if added on infinite-scroll component the Loading content does not gets displayed
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

const addtoOrder = async (product: any) => {
  const facilityId = currentFacility.value.facilityId;
  product.locationSeqId = facilityLocationsByFacilityId.value(facilityId) ? facilityLocationsByFacilityId.value(facilityId)[0]?.locationSeqId : ''
  await transferOrderStore.addOrderItem(product)
  modalController.dismiss({ dismissed: true, product });
};

const closeModal = () => {
  modalController.dismiss({ dismissed: true });
};

const selectSearchBarText = (event: any) => {
  event.target.getInputElement().then((element: any) => {
    element.select();
  })
};
</script>
