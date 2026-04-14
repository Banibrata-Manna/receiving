<template>
  <ion-page>
    <ion-content data-testid="shopify-page-content">
      <div class="center-div">
        <p>{{ translate("Installing...") }}</p>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonPage } from "@ionic/vue";
import { Redirect } from "@shopify/app-bridge/actions";
import createApp from "@shopify/app-bridge";
import { onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { translate, emitter } from '@common';

const route = useRoute();
const router = useRouter();

const apiKeyEnv = import.meta.env.VITE_SHOPIFY_API_KEY;
const shopConfigs = JSON.parse(import.meta.env.VITE_SHOPIFY_SHOP_CONFIG || '{}');
const session = route.query['session'];
const shop = route.query['shop'] as string;
const host = route.query['host'] as string;

const authorise = (shop: string, host: string, apiKey: string) => {
  const scopes = import.meta.env.VITE_SHOPIFY_SCOPES
  emitter.emit("presentLoader");
  const shopConfig = shopConfigs[shop];
  if (!apiKey) apiKey = shopConfig ? shopConfig.apiKey : '';
  const redirectUri = import.meta.env.VITE_SHOPIFY_REDIRECT_URI;
  const permissionUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${redirectUri}`;

  if (window.top == window.self) {
    window.location.assign(permissionUrl);
  } else {
    const app = createApp({
      apiKey,
      host,
    });
    Redirect.create(app).dispatch(Redirect.Action.REMOTE, permissionUrl);
  }
  emitter.emit("dismissLoader");
}

onMounted(async () => {
  const shopToAuth = shop;
  const shopConfig = shopConfigs[shopToAuth];
  const apiKey = shopConfig ? shopConfig.apiKey : '';
  
  if (shop || host) {
    authorise(shopToAuth, host, apiKey);
    router.push("/home");
  } else {
    router.push("/error");
  }
});

onBeforeUnmount(() => {
  emitter.emit("dismissLoader")
});
</script>

<style scoped>
.center-div {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
</style>
