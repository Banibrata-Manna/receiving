<template>
  <ion-app>
    <IonSplitPane content-id="main-content" when="lg">
      <Menu />
      <ion-router-outlet id="main-content"></ion-router-outlet>
    </IonSplitPane>
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet, IonSplitPane, loadingController } from '@ionic/vue';
import Menu from '@/components/Menu.vue';
import { ref, computed, onBeforeMount, onMounted, onUnmounted } from 'vue';
import emitter from "@/event-bus"
import { Settings } from 'luxon';
import { initialise, resetConfig } from '@/adapter'
import { initialiseFirebaseApp, translate , useAuthStore, useProductIdentificationStore } from "@hotwax/dxp-components"
import { addNotification, storeClientRegistrationToken } from '@/utils/firebase';
import { useUserStore } from '@/store/user';

const userStore = useUserStore();
const authStore = useAuthStore();
const productIdentificationStore = useProductIdentificationStore();

const loader = ref(null as any);
const maxAge = process.env.VUE_APP_CACHE_MAX_AGE ? parseInt(process.env.VUE_APP_CACHE_MAX_AGE) : 0;
const appFirebaseConfig = process.env.VUE_APP_FIREBASE_CONFIG ? JSON.parse(process.env.VUE_APP_FIREBASE_CONFIG) : undefined;
const appFirebaseVapidKey = process.env.VUE_APP_FIREBASE_VAPID_KEY || '';

const currentEComStore = computed(() => userStore.getCurrentEComStore);
const userProfile = computed(() => userStore.getUserProfile);
const userToken = computed(() => userStore.getUserToken);
const instanceUrl = computed(() => userStore.getInstanceUrl);
const allNotificationPrefs = computed(() => userStore.getAllNotificationPrefs);

const presentLoader = async (options = { message: '', backdropDismiss: true }) => {
  // When having a custom message remove already existing loader
  if (options.message && loader.value) dismissLoader();

  if (!loader.value) {
    loader.value = await loadingController
      .create({
        message: options.message ? translate(options.message) : translate("Click the backdrop to dismiss."),
        translucent: true,
        backdropDismiss: options.backdropDismiss
      });
  }
  await loader.value.present();
};

const dismissLoader = () => {
  if (loader.value) {
    loader.value.dismiss();
    loader.value = null;
  } else {
    // Added this else case as there are some scenarios in which the loader is not created and before that the dismissLoader gets called, resulting in the loader not getting dismissed
    // So checking that when the loader is not found then try dismissing the loader again after 3 secs.
    // The above case appears when directly hitting the shipment detail page and then the receive shipment api throws error
    // TODO: need to find a more better approach to dismiss the loader in such case
    setTimeout(() => {
      if (loader.value) {
        dismissLoader();
      }
    }, 3000)
  }
};

const unauthorized = async () => {
  const isEmbedded = authStore.isEmbedded;
  const shop = authStore.shop;
  const host = authStore.host;
  // Mark the user as unauthorised, this will help in not making the logout api call in actions
  await userStore.logout({ isUserUnauthorised: true });
  const redirectUrl = window.location.origin + '/login';
  window.location.href = isEmbedded ? `${redirectUrl}?embedded=1&shop=${shop}&host=${host}` : `${process.env.VUE_APP_LOGIN_URL}?redirectUrl=${redirectUrl}`;
};

// created logic
initialise({
  token: userToken.value,
  instanceUrl: instanceUrl.value,
  cacheMaxAge: maxAge,
  events: {
    unauthorised: unauthorized,
    responseError: () => {
      setTimeout(() => dismissLoader(), 100);
    },
    queueTask: (payload: any) => {
      emitter.emit("queueTask", payload);
    }
  }
})

onBeforeMount(() => {
  emitter.on('presentLoader', presentLoader);
  emitter.on('dismissLoader', dismissLoader);
});

onMounted(async () => {
  if (userToken.value) {
    // Get product identification from api using dxp-component
    await productIdentificationStore.getIdentificationPref(currentEComStore.value?.productStoreId)
      .catch((error) => console.error(error));

    // check if firebase configurations are there.
    if (appFirebaseConfig && appFirebaseConfig.apiKey && allNotificationPrefs.value?.length) {
      // initialising and connecting firebase app for notification support
      await initialiseFirebaseApp(
        appFirebaseConfig,
        appFirebaseVapidKey,
        storeClientRegistrationToken,
        addNotification,
      )
    }
  }

  // Handles case when user resumes or reloads the app
  // Luxon timezzone should be set with the user's selected timezone
  if (userProfile.value && userProfile.value.userTimeZone) {
    Settings.defaultZone = userProfile.value.userTimeZone;
  }
});

onUnmounted(() => {
  emitter.off('presentLoader', presentLoader);
  emitter.off('dismissLoader', dismissLoader);
  resetConfig()
});
</script>
