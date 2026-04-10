<template>
  <ion-header>
    <ion-toolbar>
      <ion-buttons slot="start">
        <ion-button data-testid="notification-preference-modal-close-btn" @click="closeModal"> 
          <ion-icon slot="icon-only" :icon="closeOutline" />
        </ion-button>
      </ion-buttons>
      <ion-title data-testid="notification-preference-modal-title">{{ translate("Notification Preference") }}</ion-title>
    </ion-toolbar>
  </ion-header>

  <ion-content data-testid="notification-preference-modal-content">
    <div v-if="!notificationPrefs.length" data-testid="notification-preference-empty-state" class="ion-text-center">
      <p>{{ translate("Notification preferences not found.")}}</p>
    </div>
    <ion-list v-else data-testid="notification-preference-list">
      <ion-item :key="pref.enumId" :data-testid="`notification-preference-row-${pref.enumId}`" v-for="pref in notificationPrefs">
        <ion-toggle :data-testid="`notification-preference-toggle-${pref.enumId}`" label-placement="start" @click="toggleNotificationPref(pref.enumId, $event)" :checked="pref.isEnabled">{{ pref.description }}</ion-toggle>
      </ion-item>
    </ion-list>
    <ion-fab vertical="bottom" horizontal="end" slot="fixed">
      <ion-fab-button data-testid="notification-preference-save-btn" :disabled="isButtonDisabled" @click="confirmSave()">
        <ion-icon :icon="save" />
      </ion-fab-button>
    </ion-fab>
  </ion-content>
</template>

<script setup lang="ts">
import { IonButtons, IonButton, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonItem, IonList, IonTitle, IonToggle, IonToolbar, modalController, alertController } from "@ionic/vue";
import { ref, computed, onBeforeMount } from "vue";
import { closeOutline, save } from "ionicons/icons";
import { useUserStore } from '@/store/user';
import { translate } from '@hotwax/dxp-components'
import { showToast } from "@/utils";
import emitter from "@/event-bus"
import { generateTopicName } from "@/utils/firebase";
import { NotificationService } from "@/services/NotificationService";

const userStore = useUserStore();

const notificationPrefState = ref({} as any);
const notificationPrefToUpdate = ref({
  subscribe: [] as string[],
  unsubscribe: [] as string[]
});
const initialNotificationPrefState = ref({} as any);

const notificationPrefs = computed(() => userStore.getNotificationPrefs);
const currentFacility = computed(() => userStore.getCurrentFacility);

const isButtonDisabled = computed(() => {
  const enumTypeIds = Object.keys(initialNotificationPrefState.value);
  return enumTypeIds.every((enumTypeId: string) => notificationPrefState.value[enumTypeId] === initialNotificationPrefState.value[enumTypeId]);
});

onBeforeMount(async () => {
  await userStore.fetchNotificationPreferences()
  notificationPrefState.value = notificationPrefs.value.reduce((prefs: any, pref: any) => {
    prefs[pref.enumId] = pref.isEnabled
    return prefs
  }, {})
  initialNotificationPrefState.value = JSON.parse(JSON.stringify(notificationPrefState.value))
});

const closeModal = () => {
  modalController.dismiss({ dismissed: true });
};

const toggleNotificationPref = (enumId: string, event: any) => {
  const value = !event.target.checked
  
  if (value !== initialNotificationPrefState.value[enumId]) {
    value
      ? notificationPrefToUpdate.value.subscribe.push(enumId)
      : notificationPrefToUpdate.value.unsubscribe.push(enumId)
  } else {
    !value
      ? notificationPrefToUpdate.value.subscribe.splice(notificationPrefToUpdate.value.subscribe.indexOf(enumId), 1)
      : notificationPrefToUpdate.value.unsubscribe.splice(notificationPrefToUpdate.value.unsubscribe.indexOf(enumId), 1)
  }

  notificationPrefState.value[enumId] = value
};

const handleTopicSubscription = async () => {
  const facilityId = currentFacility.value?.facilityId
  const subscribeRequests = notificationPrefToUpdate.value.subscribe.map((enumId: string) => {
    const topicName = generateTopicName(facilityId, enumId)
    return NotificationService.subscribeTopic(topicName, process.env.VUE_APP_NOTIF_APP_ID as string)
  })

  const unsubscribeRequests = notificationPrefToUpdate.value.unsubscribe.map((enumId: string) => {
    const topicName = generateTopicName(facilityId, enumId)
    return NotificationService.unsubscribeTopic(topicName, process.env.VUE_APP_NOTIF_APP_ID as string)
  })

  const responses = await Promise.allSettled([...subscribeRequests, ...unsubscribeRequests])
  const hasFailedResponse = responses.some((response: any) => response.status === "rejected")
  showToast(hasFailedResponse ? translate('Notification preferences not updated. Please try again.') : translate('Notification preferences updated.'))
};

const updateNotificationPref = async () => {
  emitter.emit("presentLoader");
  try {
    await handleTopicSubscription()
  } catch (error) {
    console.error(error)
  } finally {
    emitter.emit("dismissLoader")
  }
};

const confirmSave = async () => {
  const message = translate("Are you sure you want to update the notification preferences?");
  const alert = await alertController.create({
    header: translate("Update notification preferences"),
    message,
    buttons: [
      {
        text: translate("Cancel"),
      },
      {
        text: translate("Confirm"),
        handler: async () => {
          await updateNotificationPref();
          modalController.dismiss({ dismissed: true });
        }
      }
    ],
  });
  return alert.present();
};
</script>
