import { defineStore } from "pinia";
import { ReturnService } from "@/services/ReturnService";
import { hasError, showToast } from "@/utils";
import { getProductIdentificationValue, translate } from "@hotwax/dxp-components";
import emitter from "@/event-bus";
import { useUtilStore } from "@/store/util";
import { useUserStore } from "@/store/user";
import { useProductStore } from "@/store/product";

export const useReturnStore = defineStore("return", {
  state: () => ({
    current: {
      return: {} as any,
      items: [] as any,
    },
    returns: {
      list: [] as any,
      total: 0,
    },
    validStatusChange: {} as any,
  }),
  getters: {
    getReturns: (state) => state.returns.list,
    getReturnsTotal: (state) => state.returns.total,
    getCurrent: (state) => state.current,
    isReturnReceivable: (state) => (statusId: string) => state.validStatusChange[statusId]?.includes("PURCH_SHIP_RECEIVED"),
  },
  actions: {
    async findReturn(payload: any) {
      if (payload.viewIndex === 0) emitter.emit("presentLoader");
      let resp;
      try {
        resp = await ReturnService.findReturns(payload);
        if (resp.status === 200 && !hasError(resp) && resp.data.docs?.length > 0) {
          let returns = resp.data.docs;
          const statusIds = [...new Set(returns.map((returnShipment: any) => returnShipment.statusId))] as Array<string>;
          const utilStore = useUtilStore();
          const statuses = await utilStore.fetchStatus(statusIds);
          returns.map((shipment: any) => {
            shipment.statusDesc = statuses[shipment.statusId];
          });
          if (payload.viewIndex && payload.viewIndex > 0) returns = this.returns.list.concat(returns);
          this.returns = { list: returns, total: resp.data.count };
        } else {
          payload.viewIndex ? showToast(translate("Returns not found")) : (this.returns = { list: [], total: 0 });
        }
      } catch (error) {
        console.error(error);
        showToast(translate("Something went wrong"));
      }
      if (payload.viewIndex === 0) emitter.emit("dismissLoader");
      return resp;
    },

    async updateReturnProductCount(payload: any) {
      const utilStore = useUtilStore();
      const productStore = useProductStore();
      const barcodeIdentifier = utilStore.getBarcodeIdentificationPref;
      const getProduct = productStore.getProduct;

      const item = this.current.items.find((item: any) => {
        const itemVal = barcodeIdentifier
          ? getProductIdentificationValue(barcodeIdentifier, getProduct(item.productId))
          : item.internalName;
        return itemVal === payload;
      });

      if (item) {
        item.quantityAccepted = item.quantityAccepted ? parseInt(item.quantityAccepted) + 1 : 1;
        return { isProductFound: true };
      }

      return { isProductFound: false };
    },

    async setCurrent(payload: any) {
      let resp;
      try {
        let returnShipment = this.returns.list.find((shipment: any) => shipment.shipmentId === payload.shipmentId);

        if (!returnShipment) {
          const getReturnShipmentPayload = {
            entityName: "SalesReturnShipmentView",
            inputFields: { shipmentId: payload.shipmentId },
            fieldList: ["shipmentId", "externalId", "statusId", "shopifyOrderName", "hcOrderId", "trackingCode", "destinationFacilityId"],
            noConditionFind: "Y",
            viewSize: 1,
            viewIndex: 0,
          } as any;
          resp = await ReturnService.findReturns(getReturnShipmentPayload);
          if (resp.status === 200 && !hasError(resp) && resp.data.docs?.length > 0) {
            returnShipment = resp.data.docs[0];
            const utilStore = useUtilStore();
            const statuses = await utilStore.fetchStatus([returnShipment.statusId]);
            returnShipment.statusDesc = statuses[returnShipment.statusId];
          } else {
            showToast(translate("Something went wrong"));
            console.error("error", resp.data._ERROR_MESSAGE_);
            return;
          }
        }

        resp = await ReturnService.getReturnDetail(payload);

        if (resp.status === 200 && !hasError(resp) && resp.data.items) {
          const userStore = useUserStore();
          const facilityLocations = await userStore.getFacilityLocations(returnShipment.destinationFacilityId);
          if (facilityLocations.length) {
            const locationSeqId = facilityLocations[0].locationSeqId;
            resp.data.items.map((item: any) => {
              item.locationSeqId = locationSeqId;
              item.quantityReceived = item.quantityAccepted ? Number(item.quantityAccepted) : 0;
            });
          } else {
            showToast(
              translate(
                "Facility locations were not found corresponding to destination facility of return shipment. Please add facility locations to avoid receive return shipment failure."
              )
            );
          }

          this.current = { ...resp.data, ...returnShipment };
          const productIds = [...new Set(resp.data.items.map((item: any) => item.productId))] as Array<string>;

          if (productIds.length) {
            const productStore = useProductStore();
            productStore.fetchProducts({ productIds });
          }

          return resp.data;
        } else {
          showToast(translate("Something went wrong"));
          console.error("error", resp.data._ERROR_MESSAGE_);
          return Promise.reject(new Error(resp.data._ERROR_MESSAGE_));
        }
      } catch (err: any) {
        showToast(translate("Something went wrong"));
        console.error("error", err);
        return Promise.reject(new Error(err));
      }
    },

    receiveReturnItem(payload: any) {
      const facilityId = this.current.return.destinationFacilityId;
      return Promise.all(
        payload.items.map(async (item: any) => {
          const params = {
            facilityId,
            shipmentId: payload.shipmentId,
            shipmentItemSeqId: item.itemSeqId,
            productId: item.productId,
            quantityAccepted: item.quantityAccepted,
            orderId: item.orderId,
            orderItemSeqId: item.orderItemSeqId,
            unitCost: 0.0,
            locationSeqId: item.locationSeqId,
          };
          return ReturnService.receiveReturnItem(params).catch((err) => err);
        })
      );
    },

    async receiveReturn(payload: any) {
      emitter.emit("presentLoader");
      return await this.receiveReturnItem(payload)
        .then(async (response: any) => {
          if (response.some((res: any) => res.status !== 200 || hasError(res))) {
            showToast(translate("Failed to receive some of the items"));
            emitter.emit("dismissLoader");
            return;
          }

          const resp = await ReturnService.receiveReturn({
            shipmentId: payload.shipmentId,
            statusId: "PURCH_SHIP_RECEIVED",
          });
          if (resp.status === 200 && !hasError(resp)) {
            showToast(translate("Return received successfully", { shipmentId: payload.shipmentId }));
          } else {
            showToast(translate("Something went wrong"));
            console.error("error", resp.data._ERROR_MESSAGE_);
            return Promise.reject(new Error(resp.data._ERROR_MESSAGE_));
          }
          emitter.emit("dismissLoader");
          return resp;
        })
        .catch((err) => {
          console.error(err);
          return err;
        });
    },

    clearReturns() {
      this.returns = { list: [], total: 0 };
      this.current = { return: {}, items: [] };
    },

    async fetchValidReturnStatuses() {
      let resp;
      try {
        resp = await ReturnService.fetchStatusChange({
          inputFields: {
            statusIdTo: "PURCH_SHIP_RECEIVED",
            statusTypeId: "PURCH_SHIP_STATUS",
            conditionExpression_op: "empty",
          },
          fieldList: ["statusId", "statusIdTo"],
          entityName: "StatusValidChangeToDetail",
          noConditionFind: "Y",
          viewSize: 100,
        });

        if (resp.status == 200 && resp.data.count && !hasError(resp)) {
          const returnStatusValidChange = resp.data.docs.reduce((acc: any, obj: any) => {
            const status = obj["statusId"];
            if (!acc[status]) {
              acc[status] = [];
            }
            acc[status].push(obj.statusIdTo);
            return acc;
          }, {});

          this.validStatusChange = returnStatusValidChange;
        } else {
          console.error("Unable to fetch valid return status change options");
        }
      } catch (err) {
        console.error(err);
      }
    },

    setItemLocationSeqId(payload: any) {
      const item = this.current.items.find((item: any) => item.itemSeqId === payload.item.itemSeqId);
      if (item) {
        item.locationSeqId = payload.locationSeqId;
      }
    },
  },
  persist: true,
});
