import { defineStore } from "pinia";
import { UserService } from "@/services/UserService";
import { UtilService } from "@/services/UtilService";
import { getCurrentFacilityId, hasError, showToast } from "@/utils";
import { DateTime, Settings } from "luxon";
import { logout, updateInstanceUrl, updateToken, resetConfig } from "@/adapter";
import { NotificationService } from "@/services/NotificationService";
import { getServerPermissionsFromRules, prepareAppPermissions, resetPermissions, setPermissions } from "@/authorization";
import { translate, useAuthStore, useProductIdentificationStore, useUserStore as useDxpUserStore } from "@hotwax/dxp-components";
import { generateDeviceId, generateTopicName } from "@/utils/firebase";
import emitter from "@/event-bus";
import router from "@/router";
import { Facility, UserProfile } from "@/types";
import { useUtilStore } from "@/store/util";
import { useOrderStore } from "@/store/order";
import { useReturnStore } from "@/store/return";
import { usePartyStore } from "@/store/party";

export const useUserStore = defineStore("user", {
  state: () => ({
    token: "",
    current: {} as UserProfile,
    currentFacility: {} as Facility,
    currentEComStore: {} as any,
    permissions: [] as any,
    instanceUrl: "",
    facilityLocationsByFacilityId: {} as any,
    pwaState: {
      updateExists: false,
      registration: null as any,
    },
    omsRedirectionInfo: {
      url: "",
      token: "",
    },
    notifications: [] as any,
    notificationPrefs: [] as any,
    firebaseDeviceId: "",
    hasUnreadNotifications: true,
    allNotificationPrefs: [] as any,
  }),
  getters: {
    isAuthenticated: (state) => !!state.token,
    isUserAuthenticated: (state) => state.token && state.current,
    getBaseUrl: (state) => {
      let baseURL = process.env.VUE_APP_BASE_URL;
      if (!baseURL) baseURL = state.instanceUrl;
      return baseURL.startsWith("http")
        ? baseURL.includes("/api")
          ? baseURL
          : `${baseURL}/api/`
        : `https://${baseURL}.hotwax.io/api/`;
    },
    getUserToken: (state) => state.token,
    getUserProfile: (state): UserProfile => state.current,
    getCurrentFacility: (state): Facility => state.currentFacility,
    getInstanceUrl: (state) => {
      const baseUrl = process.env.VUE_APP_BASE_URL;
      return baseUrl ? baseUrl : state.instanceUrl;
    },
    getUserPermissions: (state) => state.permissions,
    getCurrentEComStore: (state) => state.currentEComStore,
    getFacilityLocationsByFacilityId: (state) => (facilityId: string) => state.facilityLocationsByFacilityId[facilityId],
    getPwaState: (state) => state.pwaState,
    getMaargBaseUrl: (state) => {
      const url = state.omsRedirectionInfo.url;
      return url.startsWith("http")
        ? url.includes("/rest/s1/")
          ? url
          : `${url}/rest/s1/`
        : `https://${url}.hotwax.io/rest/s1/`;
    },
    getOmsRedirectionInfo: (state) => state.omsRedirectionInfo,
    getNotifications: (state) => [...state.notifications].sort((a: any, b: any) => b.time - a.time),
    getNotificationPrefs: (state) => state.notificationPrefs,
    getFirebaseDeviceId: (state) => state.firebaseDeviceId,
    getUnreadNotificationsStatus: (state) => state.hasUnreadNotifications,
    getAllNotificationPrefs: (state) => state.allNotificationPrefs,
  },
  actions: {
    /**
     * Login user and return token
     */
    async login(payload: any) {
      try {
        const { token, oms, omsRedirectionUrl } = payload;
        this.setUserInstanceUrl(oms);
        const permissionId = process.env.VUE_APP_PERMISSION_ID;
        const serverPermissionsFromRules = getServerPermissionsFromRules();
        if (permissionId) serverPermissionsFromRules.push(permissionId);

        const serverPermissions = await UserService.getUserPermissions(
          { permissionIds: [...new Set(serverPermissionsFromRules)] },
          token
        );
        const appPermissions = prepareAppPermissions(serverPermissions);

        if (permissionId) {
          const hasPermission = appPermissions.some((appPermission: any) => appPermission.action === permissionId);
          if (!hasPermission) {
            const permissionError = "You do not have permission to access the app.";
            showToast(translate(permissionError));
            console.error("error", permissionError);
            return Promise.reject(new Error(permissionError));
          }
        }

        const userProfile = await UserService.getUserProfile(token);
        const moquiUser = await UserService.getMoquiUserProfile(omsRedirectionUrl, token);
        userProfile.moquiUserId = moquiUser.userId;

        const isAdminUser = appPermissions.some((appPermission: any) => appPermission?.action === "APP_RECVG_ADMIN");
        const facilities = await useDxpUserStore().getUserFacilities(userProfile?.partyId, "", isAdminUser);
        await useDxpUserStore().getFacilityPreference("SELECTED_FACILITY");

        if (!facilities.length) throw "Unable to login. User is not associated with any facility";

        userProfile.facilities = facilities;
        userProfile.facilities.reduce((uniqueFacilities: any, facility: any, index: number) => {
          if (uniqueFacilities.includes(facility.facilityId)) userProfile.facilities.splice(index, 1);
          else uniqueFacilities.push(facility.facilityId);
          return uniqueFacilities;
        }, []);

        const facilityIdFromQuery = router.currentRoute.value.query.facilityId;
        let isQueryFacilityFound = false;
        if (facilityIdFromQuery) {
          const facility = userProfile.facilities.find((f: any) => f.facilityId === facilityIdFromQuery);
          if (facility) {
            isQueryFacilityFound = true;
            this.currentFacility = facility;
          } else {
            showToast(translate("Redirecting to home page due to incorrect information being passed."));
          }
        }

        const authStore = useAuthStore();
        if (authStore.isEmbedded) {
          const locationId = authStore.posContext.locationId;
          const resp = await UtilService.fetchShopifyShopLocation(token, {
            entityName: "ShopifyShopLocation",
            inputFields: { shopifyLocationId: locationId.toString() },
            viewSize: 1,
          });
          if (!hasError(resp) && resp.data.docs?.length) {
            const facilityId = resp.data.docs[0].facilityId;
            const facility = userProfile.facilities.find((f: any) => f.facilityId === facilityId);
            if (!facility) throw "Unable to login. User is not associated with this location";
            this.currentFacility = facility;
          } else {
            throw "Failed to fetch location information";
          }
        }

        const currentFacilityId: any = getCurrentFacilityId();
        const currentEComStore = await UserService.getEComStores(token, currentFacilityId);
        this.currentEComStore = currentEComStore;
        const productStoreId = currentEComStore?.productStoreId;

        setPermissions(appPermissions);
        if (userProfile.userTimeZone) {
          Settings.defaultZone = userProfile.userTimeZone;
        }

        if (omsRedirectionUrl) {
          const api_key = await UserService.moquiLogin(omsRedirectionUrl, token);
          if (api_key) {
            this.setOmsRedirectionInfo({ url: omsRedirectionUrl, token: api_key });
          } else {
            showToast(translate("Some of the app functionality will not work due to missing configuration."));
            console.error("Some of the app functionality will not work due to missing configuration.");
          }
        } else {
          showToast(translate("Some of the app functionality will not work due to missing configuration."));
          console.error("Some of the app functionality will not work due to missing configuration.");
        }

        updateToken(token);
        this.token = token;
        this.current = userProfile;
        this.currentEComStore = currentEComStore;
        this.permissions = appPermissions;

        await useProductIdentificationStore()
          .getIdentificationPref(productStoreId)
          .catch((error) => console.error(error));

        this.getFacilityLocations(currentFacilityId);
        // Dispatching other actions manually since we're in Pinia
        const utilStore = useUtilStore();
        utilStore.getForceScanSetting(currentEComStore?.productStoreId);
        utilStore.getReceivingByFulfillmentSetting(currentEComStore?.productStoreId);
        utilStore.getBarcodeIdentificationPref(currentEComStore?.productStoreId);
        await this.fetchAllNotificationPrefs();

        const orderId = router.currentRoute.value.query.orderId;
        if (isQueryFacilityFound && orderId) {
          return `/transfer-order-detail/${orderId}`;
        }
      } catch (err: any) {
        showToast(translate("Something went wrong while login. Please contact administrator"));
        console.error("error", err);
        return Promise.reject(err instanceof Object ? err : new Error(err));
      }
    },

    /**
     * Logout user
     */
    async logout(payload: any) {
      let redirectionUrl = "";
      if (!payload?.isUserUnauthorised) {
        emitter.emit("presentLoader", { message: "Logging out", backdropDismiss: false });
        let resp;
        try {
          resp = await logout();
          resp = JSON.parse(resp.startsWith("//") ? resp.replace("//", "") : resp);
        } catch (err) {
          console.error("Error parsing data", err);
        }
        if (resp?.logoutAuthType === "SAML2SSO") {
          redirectionUrl = resp.logoutUrl;
        }
      }

      const authStore = useAuthStore();
      const utilStore = useUtilStore();
      const orderStore = useOrderStore();
      const returnStore = useReturnStore();
      const partyStore = usePartyStore();

      this.$reset();
      this.clearNotificationState();
      orderStore.clearPurchaseOrders();
      returnStore.clearReturns();
      partyStore.resetReceiversDetails();
      utilStore.updateForceScanStatus(false);
      utilStore.updateBarcodeIdentificationPref("");
      resetPermissions();
      resetConfig();
      authStore.$reset();

      if (redirectionUrl) {
        window.location.href = redirectionUrl;
      }

      emitter.emit("dismissLoader");
      return redirectionUrl;
    },

    /**
     * update current facility information
     */
    async setFacility(facilityId: string) {
      const token = this.token;
      const previousEComStore = (await this.getCurrentEComStore) as any;
      const eComStore = await UserService.getEComStores(token, facilityId);
      await this.getFacilityLocations(facilityId);
      const utilStore = useUtilStore();
      if (!Object.keys(eComStore).length) {
        this.currentEComStore = {};
        await this.updateSettingsToDefault();
        await useProductIdentificationStore()
          .getIdentificationPref("")
          .catch((error) => console.error(error));
      } else if (previousEComStore.productStoreId !== eComStore.productStoreId) {
        await useDxpUserStore().setEComStorePreference(eComStore);
        this.currentEComStore = eComStore;
        utilStore.getForceScanSetting(eComStore.productStoreId);
        utilStore.getReceivingByFulfillmentSetting(eComStore.productStoreId);
        utilStore.getBarcodeIdentificationPref(eComStore.productStoreId);
        await useProductIdentificationStore()
          .getIdentificationPref(eComStore.productStoreId)
          .catch((error) => console.error(error));
      }
    },

    async updateSettingsToDefault() {
      const utilStore = useUtilStore();
      utilStore.updateForceScanStatus(false);
      utilStore.updateBarcodeIdentificationPref("internalName");
    },

    /**
     * Update user timeZone
     */
    async setUserTimeZone(timeZoneId: string) {
      this.current.userTimeZone = timeZoneId;
      Settings.defaultZone = timeZoneId;
    },

    setUserInstanceUrl(payload: string) {
      this.instanceUrl = payload;
      updateInstanceUrl(payload);
    },

    async getFacilityLocations(facilityId: string) {
      const facilityLocations = this.facilityLocationsByFacilityId[facilityId];
      if (facilityLocations) {
        return facilityLocations;
      }
      let resp;
      const payload = {
        inputFields: { facilityId },
        viewSize: 20,
        fieldList: ["locationSeqId", "areaId", "aisleId", "sectionId", "levelId", "positionId"],
        entityName: "FacilityLocation",
        distinct: "Y",
        noConditionFind: "Y",
      };
      try {
        resp = await UserService.getFacilityLocations(payload);
        if (resp.status === 200 && !hasError(resp) && resp.data?.count > 0) {
          let locations = resp.data.docs;
          locations = locations.map((location: any) => {
            const locationPath = [
              location.areaId,
              location.aisleId,
              location.sectionId,
              location.levelId,
              location.positionId,
            ]
              .filter((value: any) => value)
              .join("");
            return { locationSeqId: location.locationSeqId, locationPath: locationPath };
          });
          this.facilityLocationsByFacilityId[facilityId] = locations;
          return locations;
        } else {
          console.error(resp);
          return [];
        }
      } catch (err) {
        console.error(err);
        return [];
      }
    },

    updatePwaState(payload: any) {
      this.pwaState.registration = payload.registration;
      this.pwaState.updateExists = payload.updateExists;
    },

    setOmsRedirectionInfo(payload: any) {
      this.omsRedirectionInfo = payload;
    },

    async storeClientRegistrationToken(registrationToken: string) {
      const firebaseDeviceId = generateDeviceId();
      this.firebaseDeviceId = firebaseDeviceId;
      try {
        await NotificationService.storeClientRegistrationToken(
          registrationToken,
          firebaseDeviceId,
          process.env.VUE_APP_NOTIF_APP_ID
        );
      } catch (error) {
        console.error(error);
      }
    },

    addNotification(payload: any) {
      const notifications = JSON.parse(JSON.stringify(this.notifications));
      notifications.push({ ...payload.notification, time: DateTime.now().toMillis() });
      this.hasUnreadNotifications = true;
      if (payload.isForeground) {
        showToast(translate("New notification received."));
      }
      this.notifications = notifications;
    },

    async fetchAllNotificationPrefs() {
      let allNotificationPrefs = [];
      try {
        const resp = await NotificationService.getNotificationUserPrefTypeIds(
          process.env.VUE_APP_NOTIF_APP_ID,
          this.current.moquiUserId,
          { topic: getCurrentFacilityId(), topic_op: "contains" }
        );
        allNotificationPrefs = resp;
      } catch (error) {
        console.error(error);
      }
      this.allNotificationPrefs = allNotificationPrefs;
    },

    async fetchNotificationPreferences() {
      let notificationPreferences = [],
        enumerationResp = [],
        userPrefIds = [] as any;
      try {
        enumerationResp = await NotificationService.getNotificationEnumIds(process.env.VUE_APP_NOTIF_ENUM_TYPE_ID);
        const resp = await NotificationService.getNotificationUserPrefTypeIds(
          process.env.VUE_APP_NOTIF_APP_ID,
          this.current.moquiUserId,
          { topic: getCurrentFacilityId(), topic_op: "contains" }
        );
        userPrefIds = resp.map((userPref: any) => userPref.topic);
      } catch (error) {
        console.error(error);
      } finally {
        if (enumerationResp?.length) {
          notificationPreferences = enumerationResp.reduce((notificationPref: any, pref: any) => {
            const userPrefTypeIdToSearch = generateTopicName(getCurrentFacilityId(), pref.enumId);
            notificationPref.push({ ...pref, isEnabled: userPrefIds.includes(userPrefTypeIdToSearch) });
            return notificationPref;
          }, []);
        }
        this.notificationPrefs = notificationPreferences;
      }
    },

    updateNotificationPreferences(payload: any) {
      this.notificationPrefs = payload;
    },

    clearNotificationState() {
      this.notifications = [];
      this.notificationPrefs = [];
      this.hasUnreadNotifications = true;
    },

    clearDeviceId() {
      this.firebaseDeviceId = "";
    },

    setUnreadNotificationsStatus(payload: boolean) {
      this.hasUnreadNotifications = payload;
    },
  },
  persist: true,
});
