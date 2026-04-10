<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-menu-button data-testid="settings-page-menu-btn" slot="start" />
        <ion-title>{{ translate("Settings") }}</ion-title>
      </ion-toolbar>
    </ion-header>
    
    <ion-content data-testid="settings-page-content">
      <div class="user-profile">
        <ion-card>
          <ion-item lines="full">
            <ion-avatar slot="start" v-if="userProfile?.partyImageUrl">
              <Image :src="userProfile.partyImageUrl"/>
            </ion-avatar>
            <!-- ion-no-padding to remove extra side/horizontal padding as additional padding 
            is added on sides from ion-item and ion-padding-vertical to compensate the removed
            vertical padding -->
            <ion-card-header class="ion-no-padding ion-padding-vertical">
              <ion-card-subtitle>{{ userProfile.userLoginId }}</ion-card-subtitle>
              <ion-card-title>{{ userProfile.partyName }}</ion-card-title>
            </ion-card-header>
          </ion-item>
          <ion-button data-testid="settings-page-logout-btn" color="danger" v-if="!authStore.isEmbedded" @click="logout()">{{ translate("Logout") }}</ion-button>
          <ion-button data-testid="settings-page-launchpad-btn" v-if="!authStore.isEmbedded" :standalone-hidden="!hasPermission(Actions.APP_PWA_STANDALONE_ACCESS)" fill="outline" @click="goToLaunchpad()">
            {{ translate("Go to Launchpad") }}
            <ion-icon slot="end" :icon="openOutline" />
          </ion-button>
          <!-- Commenting this code as we currently do not have reset password functionality -->
          <!-- <ion-button fill="outline" color="medium">{{ translate("Reset password") }}</ion-button> -->
        </ion-card>
      </div>

      <div class="section-header">
        <h1>{{ translate('OMS') }}</h1>
      </div>
      <section>
        <DxpOmsInstanceNavigator />
        <DxpFacilitySwitcher @updateFacility="updateFacility" />
      </section>
      <hr />

      <DxpAppVersionInfo />

      <section>
        <DxpProductIdentifier />
        <DxpTimeZoneSwitcher @timeZoneUpdated="timeZoneUpdated" />

        <ion-card>
          <ion-card-header>
            <ion-card-title>
              {{ translate("Force scan") }}
            </ion-card-title>
          </ion-card-header>
          <ion-card-content v-html="barcodeContentMessage"></ion-card-content>
          <ion-item :disabled="!hasPermission(Actions.APP_UPDT_FULFILL_FORCE_SCAN_CONFIG)">
            <ion-toggle data-testid="settings-page-force-scan-toggle" label-placement="start" :checked="isForceScanEnabled" @click.prevent="updateForceScanStatus($event)">{{ translate("Require scanning") }}</ion-toggle>
          </ion-item>
          <ion-item lines="none">
            <ion-select data-testid="settings-page-barcode-identifier-select" :label="translate('Barcode Identifier')" interface="popover" :placeholder="translate('Select')" :value="barcodeIdentificationPref" @ionChange="setBarcodeIdentificationPref($event.detail.value)">
              <ion-select-option :data-testid="`settings-page-barcode-option-${identification.goodIdentificationTypeId}`" v-for="identification in barcodeIdentificationOptions" :key="identification" :value="identification.goodIdentificationTypeId" >{{ identification.description ? identification.description : identification.goodIdentificationTypeId }}</ion-select-option>
            </ion-select>
          </ion-item>
        </ion-card>

        <!-- <ion-card v-if="notificationPrefs.length">
          <ion-card-header>
            <ion-card-title>
              {{ translate("Notification Preference") }}
            </ion-card-title>
          </ion-card-header>
          <ion-card-content>
            {{ translate("Select the notifications you want to receive.") }}
          </ion-card-content>
          <ion-list>
            <ion-item :data-testid="`settings-page-notification-row-${pref.enumId}`" :key="pref.enumId" v-for="pref in notificationPrefs" lines="none">
              <ion-toggle :data-testid="`settings-page-notification-toggle-${pref.enumId}`" label-placement="start" @click.prevent="confirmNotificationPrefUpdate(pref.enumId, $event)" :checked="pref.isEnabled">{{ pref.description }}</ion-toggle>
            </ion-item>
          </ion-list>
        </ion-card> -->

        <ion-card>
          <ion-card-header>
            <ion-card-title>
              {{ translate("Receive flow type") }}
            </ion-card-title>
          </ion-card-header>
          <ion-card-content>
            {{ translate("Define the receiving flow for TO items") }}
          </ion-card-content>
          <ion-item :disabled="!hasPermission(Actions.APP_UPDT_RECEIVE_FLOW_CONFIG)">
            <ion-toggle data-testid="settings-page-receive-flow-toggle" label-placement="start" :checked="isReceivingByFulfillment" @click.prevent="updateReceiveFlowType($event)">{{ translate("Receive by fulfillment") }}</ion-toggle>
          </ion-item>
        </ion-card>
      </section>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonAvatar, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonContent, IonHeader, IonIcon, IonItem, IonMenuButton, IonPage, IonSelect, IonSelectOption, IonTitle, IonToggle, IonToolbar, alertController, onIonViewWillEnter } from '@ionic/vue';
import { computed, onMounted, ref } from 'vue';
import { openOutline } from 'ionicons/icons'
import { useRouter } from 'vue-router';
import { getCurrentFacilityId, showToast } from '@/utils';
import emitter from '@/event-bus';
import Image from '@/components/Image.vue'
import { Actions, hasPermission } from '@/authorization';
import { initialiseFirebaseApp, translate, useAuthStore, useProductIdentificationStore } from "@hotwax/dxp-components"
import { addNotification, generateTopicName, isFcmConfigured, storeClientRegistrationToken } from "@/utils/firebase";
import { NotificationService } from '@/services/NotificationService';
import { useStore as useUserStore } from '@/store/user';
import { useStore as useUtilStore } from '@/store/util';
import { useStore as useShipmentStore } from '@/store/shipment';
import { useStore as useReturnStore } from '@/store/return';
import { useStore as usePartyStore } from '@/store/party';

const router = useRouter();
const userStore = useUserStore();
const utilStore = useUtilStore();
const shipmentStore = useShipmentStore();
const returnStore = useReturnStore();
const partyStore = usePartyStore();
const authStore = useAuthStore();
const productIdentificationStore = useProductIdentificationStore();

const baseURL = process.env.VUE_APP_BASE_URL;
const appInfo = ref(process.env.VUE_APP_VERSION_INFO ? JSON.parse(process.env.VUE_APP_VERSION_INFO) : {});
const appVersion = ref("");
const barcodeContentMessage = translate("Only allow received quantity to be incremented by scanning the barcode of products. If the identifier is not found, the scan will default to using the internal name.", { space: '<br /><br />' });

const userProfile = computed(() => userStore.getUserProfile);
const isForceScanEnabled = computed(() => utilStore.isForceScanEnabled);
const isReceivingByFulfillment = computed(() => utilStore.isReceivingByFulfillment);
const barcodeIdentificationPref = computed(() => utilStore.getBarcodeIdentificationPref);
const notificationPrefs = computed(() => userStore.getNotificationPrefs);
const allNotificationPrefs = computed(() => userStore.getAllNotificationPrefs);
const firebaseDeviceId = computed(() => userStore.getFirebaseDeviceId);
const barcodeIdentificationOptions = computed(() => productIdentificationStore.getGoodIdentificationOptions);

onMounted(() => {
  appVersion.value = appInfo.value.branch ? (appInfo.value.branch + "-" + appInfo.value.revision) : appInfo.value.tag;
});

onIonViewWillEnter(async () => {
  await userStore.fetchNotificationPreferences();
});

const timeZoneUpdated = async (tzId: string) => {
  await userStore.setUserTimeZone(tzId);
};

const updateFacility = async (facility: any) => {
  shipmentStore.clearShipments();
  await userStore.setFacility(facility?.facilityId);
  await userStore.fetchNotificationPreferences();
};

const logout = async () => {
  try {
    await NotificationService.removeClientRegistrationToken(firebaseDeviceId.value, process.env.VUE_APP_NOTIF_APP_ID);
  } catch (error) {
    console.error(error);
  }

  userStore.clearDeviceId();

  userStore.logout({ isUserUnauthorised: false }).then((redirectionUrl: any) => {
    shipmentStore.clearShipments();
    returnStore.clearReturns();
    partyStore.resetReceiversDetails();

    if (!redirectionUrl) {
      const redirectUrl = window.location.origin + '/login';
      window.location.href = `${process.env.VUE_APP_LOGIN_URL}?isLoggedOut=true&redirectUrl=${redirectUrl}`;
    }
  });
};

const goToLaunchpad = () => {
  window.location.href = `${process.env.VUE_APP_LOGIN_URL}`;
};

const setBarcodeIdentificationPref = (value: string) => {
  utilStore.setBarcodeIdentificationPref(value);
};

const updateForceScanStatus = async (event: any) => {
  event.stopImmediatePropagation();
  utilStore.setForceScanSetting(!isForceScanEnabled.value);
};

const updateReceiveFlowType = async (event: any) => {
  event.stopImmediatePropagation();
  utilStore.setReceivingByFulfillmentSetting(!isReceivingByFulfillment.value);
};

const confirmNotificationPrefUpdate = async (enumId: string, event: CustomEvent) => {
  event.stopImmediatePropagation();

  const message = translate("Are you sure you want to update the notification preferences?");
  const alert = await alertController.create({
    header: translate("Update notification preferences"),
    message,
    buttons: [
      {
        text: translate("Cancel"),
        role: "cancel"
      },
      {
        text: translate("Confirm"),
        handler: async () => {
          alertController.dismiss();
          await updateNotificationPref(enumId);
        }
      }
    ],
  });
  return alert.present();
};

const updateNotificationPref = async (enumId: string) => {
  let isToggledOn = false;

  try {
    if (!isFcmConfigured()) {
      console.error("FCM is not configured.");
      showToast(translate('Notification preferences not updated. Please try again.'));
      return;
    }

    emitter.emit('presentLoader', { backdropDismiss: false });
    const facilityId = getCurrentFacilityId();
    const topicName = generateTopicName(facilityId, enumId);

    const notificationPref = notificationPrefs.value.find((pref: any) => pref.enumId === enumId);
    notificationPref.isEnabled ? await NotificationService.unsubscribeTopic(topicName, process.env.VUE_APP_NOTIF_APP_ID) : await NotificationService.subscribeTopic(topicName, process.env.VUE_APP_NOTIF_APP_ID);
    isToggledOn = !notificationPref.isEnabled;
    notificationPref.isEnabled = !notificationPref.isEnabled;

    await userStore.updateNotificationPreferences(notificationPrefs.value);
    showToast(translate('Notification preferences updated.'));
  } catch (error) {
    showToast(translate('Notification preferences not updated. Please try again.'));
  } finally {
    emitter.emit("dismissLoader");
  }

  try {
    if (!allNotificationPrefs.value.length && isToggledOn) {
      await initialiseFirebaseApp(JSON.parse(process.env.VUE_APP_FIREBASE_CONFIG), process.env.VUE_APP_FIREBASE_VAPID_KEY, storeClientRegistrationToken, addNotification);
    } else if (allNotificationPrefs.value.length == 1 && !isToggledOn) {
      await NotificationService.removeClientRegistrationToken(firebaseDeviceId.value, process.env.VUE_APP_NOTIF_APP_ID);
    }
    await userStore.fetchAllNotificationPrefs();
  } catch (error) {
    console.error(error);
  }
};
</script>

<style scoped>
  ion-card > ion-button {
    margin: var(--spacer-xs);
  }
  section {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    align-items: start;
  }
  .user-profile {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  }
  hr {
    border-top: 1px solid var(--ion-color-medium);
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacer-xs) 10px 0px;
  }
</style>
