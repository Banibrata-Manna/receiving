import { defineStore } from "pinia";
import { UtilService } from "@/services/UtilService";
import { hasError, showToast } from "@/utils";
import { translate } from "@hotwax/dxp-components";
import { useUserStore } from "@/store/user";

export const useUtilStore = defineStore("util", {
  state: () => ({
    status: {} as any,
    isForceScanEnabled: false,
    barcodeIdentificationPref: "",
    isReceivingByFulfillment: false,
  }),
  getters: {
    getStatusDesc: (state) => (statusId: string) => state.status[statusId],
    getIsForceScanEnabled: (state) => state.isForceScanEnabled,
    getBarcodeIdentificationPref: (state) => state.barcodeIdentificationPref,
    getIsReceivingByFulfillment: (state) => state.isReceivingByFulfillment,
  },
  actions: {
    async fetchStatus(statusIds: Array<string>) {
      const cachedStatus = JSON.parse(JSON.stringify(this.status));
      const statusIdFilter = statusIds.reduce((filter: Array<string>, statusId: any) => {
        if (!cachedStatus[statusId]) {
          filter.push(statusId);
        }
        return filter;
      }, []);

      if (statusIdFilter.length <= 0) return cachedStatus;

      try {
        const resp = await UtilService.fetchStatus({
          entityName: "StatusItem",
          noConditionFind: "Y",
          distinct: "Y",
          viewSize: statusIdFilter.length,
          inputFields: {
            statusId: statusIdFilter,
            statusId_op: "in",
          },
          fieldList: ["statusId", "description"],
        });
        if (resp.status === 200 && !hasError(resp) && resp.data?.count) {
          const statuses = resp.data.docs;
          statuses.reduce((cached: any, status: any) => {
            cached[status.statusId] = status.description;
            return cached;
          }, cachedStatus);
          this.status = cachedStatus;
        }
      } catch (err) {
        console.error("Something went wrong while fetching status for shipments");
      }
      return cachedStatus;
    },

    async getForceScanSetting(eComStoreId: string) {
      const payload = {
        inputFields: {
          productStoreId: eComStoreId,
          settingTypeEnumId: "RECEIVE_FORCE_SCAN",
        },
        entityName: "ProductStoreSetting",
        fieldList: ["settingValue", "settingTypeEnumId"],
        viewSize: 1,
      };

      try {
        const resp = (await UtilService.getProductStoreSetting(payload)) as any;
        if (!hasError(resp)) {
          const respValue = resp.data.docs[0].settingValue;
          this.isForceScanEnabled = respValue === "true";
        } else {
          this.createForceScanSetting();
        }
      } catch (err) {
        console.error(err);
        this.isForceScanEnabled = false;
      }
    },

    async createForceScanSetting() {
      const userStore = useUserStore();
      const ecomStore = userStore.getCurrentEComStore;
      let isSettingExists = false;

      try {
        if (!(await UtilService.isEnumExists("RECEIVE_FORCE_SCAN"))) {
          const resp = await UtilService.createEnumeration({
            enumId: "RECEIVE_FORCE_SCAN",
            enumTypeId: "PROD_STR_STNG",
            description: "Impose force scanning of items while packing from receiving app",
            enumName: "Receiving Force Scan",
            enumCode: "RECEIVE_FORCE_SCAN",
          });

          if (hasError(resp)) {
            throw resp.data;
          }
        }

        const params = {
          productStoreId: ecomStore.productStoreId,
          settingTypeEnumId: "RECEIVE_FORCE_SCAN",
          settingValue: "false",
        };

        await UtilService.createForceScanSetting(params);
        isSettingExists = true;
      } catch (err) {
        console.error(err);
      }

      this.isForceScanEnabled = false;
      return isSettingExists;
    },

    async setForceScanSetting(value: boolean) {
      const userStore = useUserStore();
      const eComStoreId = userStore.getCurrentEComStore.productStoreId;

      if (!eComStoreId) {
        showToast(translate("Unable to update force scan preference since no product store config found."));
        return;
      }

      let isSettingExists = false;

      try {
        const resp = (await UtilService.getProductStoreSetting({
          inputFields: {
            productStoreId: eComStoreId,
            settingTypeEnumId: "RECEIVE_FORCE_SCAN",
          },
          entityName: "ProductStoreSetting",
          fieldList: ["settingTypeEnumId"],
          viewSize: 1,
        })) as any;
        if (!hasError(resp) && resp.data.docs[0]?.settingTypeEnumId) {
          isSettingExists = true;
        }
      } catch (err) {
        console.error(err);
      }

      if (!isSettingExists) {
        isSettingExists = await this.createForceScanSetting();
      }

      if (!isSettingExists) {
        showToast(translate("Failed to update force scan preference."));
        return;
      }

      const params = {
        productStoreId: eComStoreId,
        settingTypeEnumId: "RECEIVE_FORCE_SCAN",
        settingValue: `${value}`,
      };

      try {
        const resp = (await UtilService.updateForceScanSetting(params)) as any;

        if (!hasError(resp)) {
          showToast(translate("Force scan preference updated successfully."));
          this.isForceScanEnabled = value;
        } else {
          throw resp.data;
        }
      } catch (err) {
        showToast(translate("Failed to update force scan preference."));
        console.error(err);
      }
    },

    async getBarcodeIdentificationPref(eComStoreId: string) {
      const payload = {
        inputFields: {
          productStoreId: eComStoreId,
          settingTypeEnumId: "BARCODE_IDEN_PREF",
        },
        entityName: "ProductStoreSetting",
        fieldList: ["settingValue", "settingTypeEnumId"],
        viewSize: 1,
      };

      try {
        const resp = (await UtilService.getProductStoreSetting(payload)) as any;
        if (!hasError(resp)) {
          const respValue = resp.data.docs[0].settingValue;
          this.barcodeIdentificationPref = respValue;
        } else {
          this.createBarcodeIdentificationPref();
        }
      } catch (err) {
        console.error(err);
        this.barcodeIdentificationPref = "internalName";
      }
    },

    async createBarcodeIdentificationPref() {
      const userStore = useUserStore();
      const ecomStore = userStore.getCurrentEComStore;
      let isSettingExists = false;

      try {
        if (!(await UtilService.isEnumExists("BARCODE_IDEN_PREF"))) {
          const resp = await UtilService.createEnumeration({
            enumId: "BARCODE_IDEN_PREF",
            enumTypeId: "PROD_STR_STNG",
            description: "Identification preference to be used for scanning items.",
            enumName: "Barcode Identification Preference",
            enumCode: "BARCODE_IDEN_PREF",
          });

          if (hasError(resp)) {
            throw resp.data;
          }
        }

        const params = {
          productStoreId: ecomStore.productStoreId,
          settingTypeEnumId: "BARCODE_IDEN_PREF",
          settingValue: "internalName",
        };

        await UtilService.createBarcodeIdentificationPref(params);
        isSettingExists = true;
      } catch (err) {
        console.error(err);
      }

      this.barcodeIdentificationPref = "internalName";
      return isSettingExists;
    },

    async setBarcodeIdentificationPref(value: string) {
      const userStore = useUserStore();
      const eComStoreId = userStore.getCurrentEComStore.productStoreId;

      if (!eComStoreId) {
        showToast(translate("Unable to update barcode identification preference since no product store config found."));
        return;
      }

      let isSettingExists = false;

      try {
        const resp = (await UtilService.getProductStoreSetting({
          inputFields: {
            productStoreId: eComStoreId,
            settingTypeEnumId: "BARCODE_IDEN_PREF",
          },
          entityName: "ProductStoreSetting",
          fieldList: ["settingTypeEnumId"],
          viewSize: 1,
        })) as any;
        if (!hasError(resp) && resp.data.docs[0]?.settingTypeEnumId) {
          isSettingExists = true;
        }
      } catch (err) {
        console.error(err);
      }

      if (!isSettingExists) {
        isSettingExists = await this.createBarcodeIdentificationPref();
      }

      if (!isSettingExists) {
        showToast(translate("Failed to update barcode identification preference."));
        return;
      }

      const params = {
        productStoreId: eComStoreId,
        settingTypeEnumId: "BARCODE_IDEN_PREF",
        settingValue: value,
      };

      try {
        const resp = (await UtilService.updateBarcodeIdentificationPref(params)) as any;

        if (!hasError(resp)) {
          showToast(translate("Barcode identification preference updated successfully."));
          this.barcodeIdentificationPref = value;
        } else {
          throw resp.data;
        }
      } catch (err) {
        showToast(translate("Failed to update barcode identification preference."));
        console.error(err);
      }
    },

    async getReceivingByFulfillmentSetting(eComStoreId: string) {
      const payload = {
        inputFields: {
          productStoreId: eComStoreId,
          settingTypeEnumId: "RECEIVE_BY_FULFILL",
        },
        entityName: "ProductStoreSetting",
        fieldList: ["settingValue", "settingTypeEnumId"],
        viewSize: 1,
      };

      try {
        const resp = (await UtilService.getProductStoreSetting(payload)) as any;
        if (!hasError(resp)) {
          const respValue = resp.data.docs[0].settingValue;
          this.isReceivingByFulfillment = respValue === "true";
        }
      } catch (err) {
        console.error(err);
        this.isReceivingByFulfillment = false;
      }
    },

    async setReceivingByFulfillmentSetting(value: boolean) {
      const userStore = useUserStore();
      const eComStoreId = userStore.getCurrentEComStore.productStoreId;

      if (!eComStoreId) {
        showToast(translate("Unable to update receiving flow type preference since no product store config found."));
        return;
      }

      let isSettingExists = false;

      try {
        const resp = (await UtilService.getProductStoreSetting({
          inputFields: {
            productStoreId: eComStoreId,
            settingTypeEnumId: "RECEIVE_BY_FULFILL",
          },
          entityName: "ProductStoreSetting",
          fieldList: ["settingTypeEnumId"],
          viewSize: 1,
        })) as any;
        if (!hasError(resp) && resp.data.docs[0]?.settingTypeEnumId) {
          isSettingExists = true;
        }
      } catch (err) {
        console.error(err);
      }

      if (!isSettingExists) {
        showToast(translate("Failed to update receiving flow preference."));
        return;
      }

      const params = {
        productStoreId: eComStoreId,
        settingTypeEnumId: "RECEIVE_BY_FULFILL",
        settingValue: `${value}`,
      };

      try {
        const resp = (await UtilService.updateReceiveByFulfillmentSetting(params)) as any;

        if (!hasError(resp)) {
          showToast(translate("Receiving flow preference updated successfully."));
          this.isReceivingByFulfillment = value;
        } else {
          throw resp.data;
        }
      } catch (err) {
        showToast(translate("Failed to update receiving flow preference."));
        console.error(err);
      }
    },

    updateForceScanStatus(payload: boolean) {
      this.isForceScanEnabled = payload;
    },

    updateReceiveTOFlowSetting(payload: boolean) {
      this.isReceivingByFulfillment = payload;
    },

    updateBarcodeIdentificationPref(payload: string) {
      this.barcodeIdentificationPref = payload;
    },
  },
  persist: true,
});
