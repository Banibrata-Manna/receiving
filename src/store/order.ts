import { defineStore } from "pinia";
import { api, commonUtil, emitter, translate } from "@common";
import { useProductStore as useProduct } from "@/store/product";
import { useProductStore } from "@/store/productStore";
import { useShipmentStore } from "@/store/shipment";
import { useUserStore } from "@/store/user";
import { usePartyStore } from "@/store/party";

export const useOrderStore = defineStore("order", {
  state: () => ({
    purchaseOrders: {
      list: [] as any,
      total: 0,
    },
    current: {
      orderId: "",
      externalOrderId: "",
      orderStatusId: "",
      orderStatusDesc: "",
      items: [] as any,
      poHistory: {
        items: [] as any,
      },
    },
  }),
  getters: {
    getPurchaseOrders: (state) => state.purchaseOrders.list,
    getPurchaseOrdersTotal: (state) => state.purchaseOrders.total,
    isScrollable: (state) => state.purchaseOrders.list.length > 0 && state.purchaseOrders.list.length < state.purchaseOrders.total,
    getCurrent: (state) => state.current,
    isProductAvailableInOrder: (state) => (productId: string) => state.current.items.some((item: any) => item.productId === productId),
    getPOHistory: (state) => state.current.poHistory,
    getPOItemAccepted: (state) => (productId: string) => {
      return state.current.poHistory.items
        ?.filter((item: any) => item.productId === productId)
        .reduce((sum: any, item: any) => sum + item.quantityAccepted, 0);
    },
  },
  actions: {
    async findPurchaseOrders(payload: any) {
      if (payload.json.params.start === 0) emitter.emit("presentLoader");
      let resp: any;
      try {
        resp = await api({
          url: "/solr-query",
          method: "POST",
          data: payload,
        });

        if (resp.status === 200 && !commonUtil.hasError(resp) && resp.data.grouped?.orderId.groups?.length > 0) {
          const orders = resp.data.grouped.orderId;

          orders.groups.forEach((order: any) => {
            order.doclist.docs.forEach((item: any) => {
              item.quantityAccepted = 0;
            });
          });

          if (payload.json.params.start && payload.json.params.start > 0) orders.groups = this.purchaseOrders.list.concat(orders.groups);
          this.purchaseOrders = {
            list: orders.groups,
            total: orders.ngroups,
          };
        } else {
          payload.json.params.start
            ? commonUtil.showToast(translate("Purchase orders not found"))
            : (this.purchaseOrders = { list: [], total: 0 });
        }
      } catch (error) {
        console.error(error);
        commonUtil.showToast(translate("Something went wrong"));
      }
      if (payload.json.params.start === 0) emitter.emit("dismissLoader");
      return resp;
    },

    async updateProductCount(payload: any) {
      const product = useProduct();
      const productStore = useProductStore();
      const barcodeIdentifier = productStore.getBarcodeIdentifierPref;
      const getProduct = product.getProduct;

      const item = this.current.items.find((item: any) => {
        const itemVal = barcodeIdentifier
          ? commonUtil.getProductIdentificationValue(barcodeIdentifier, getProduct(item.productId))
          : item.internalName;
        return itemVal === payload;
      });

      if (item) {
        if (item.orderItemStatusId === "ITEM_COMPLETED") return { isCompleted: true };

        item.quantityAccepted = item.quantityAccepted ? parseInt(item.quantityAccepted) + 1 : 1;
        return { isProductFound: true };
      }

      return { isProductFound: false };
    },

    async addOrderItem(payload: any) {
      const product = {
        ...payload,
        quantityAccepted: 0,
        quantityOrdered: 0,
      };
      this.current.items.push(product);
    },

    async getOrderDetail({ orderId }: { orderId: string }) {
      let resp: any;

      try {
        const payload = {
          json: {
            params: {
              rows: 10,
              group: true,
              "group.field": "orderId",
              "group.limit": 10000,
            },
            query: "docType:ORDER",
            filter: [
              `orderTypeId: PURCHASE_ORDER AND orderId: ${orderId} AND orderStatusId: (ORDER_APPROVED OR ORDER_CREATED OR ORDER_COMPLETED) AND facilityId: ${useProductStore().getCurrentFacility.facilityId}`,
            ],
          },
        };
        resp = await api({
          url: "/solr-query",
          method: "POST",
          data: payload,
        });

        if (resp.status === 200 && !commonUtil.hasError(resp) && resp.data.grouped) {
          const order = resp.data.grouped.orderId.groups[0];
          order.doclist.docs.forEach((product: any) => {
            product.quantityAccepted = 0;
          });
          const product = useProduct();
          product.fetchProductInformation({ order: order.doclist.docs });
          this.current = {
            orderId: order.groupValue,
            externalOrderId: order.doclist.docs[0]?.externalOrderId,
            orderStatusId: order.doclist.docs[0]?.orderStatusId,
            orderStatusDesc: order.doclist.docs[0]?.orderStatusDesc,
            items: order.doclist.docs,
            poHistory: { items: [] },
          };
        } else {
          commonUtil.showToast(translate("Something went wrong"));
          this.current = {
            orderId,
            externalOrderId: "",
            orderStatusId: "",
            orderStatusDesc: "",
            items: [],
            poHistory: { items: [] },
          };
        }
      } catch (error) {
        commonUtil.showToast(translate("Something went wrong"));
        this.current = {
          orderId,
          externalOrderId: "",
          orderStatusId: "",
          orderStatusDesc: "",
          items: [],
          poHistory: { items: [] },
        };
      }
      return resp;
    },

    async createPurchaseShipment(payload: any) {
      let resp: any;
      try {
        const params = {
          orderId: payload.orderId,
          facilityId: useProductStore().getCurrentFacility.facilityId,
        };

        resp = await api({
          url: "/service/createPurchaseShipment",
          method: "POST",
          data: params,
        });

        if (resp.status === 200 && !commonUtil.hasError(resp) && resp.data.shipmentId) {
          const shipmentId = resp.data.shipmentId;
          const shipmentStore = useShipmentStore();

          await Promise.all(
            payload.items.map((item: any, index: number) => {
              const shipmentItemSeqId = `0000${index + 1}`;
              return shipmentStore.addShipmentItem({ item, shipmentId, shipmentItemSeqId, orderId: params.orderId });
            })
          ).then(async (resp) => {
            resp.map((response: any) => {
              payload.items.map((item: any) => {
                if (item.productId === response.data.productId) {
                  item.itemSeqId = response.data.shipmentItemSeqId;
                }
              });
            });

            const poShipment = {
              shipmentId,
              items: payload.items,
              isMultiReceivingEnabled: true,
            };
            await shipmentStore.receiveShipment(poShipment).catch((err) => console.error(err));
          });
        } else {
          commonUtil.showToast(translate("Something went wrong"));
        }
      } catch (error) {
        console.error(error);
        commonUtil.showToast(translate("Something went wrong"));
      }
      return resp;
    },

    async createAndReceiveIncomingShipment(payload: any) {
      let resp: any;
      try {
        payload.items.map((item: any, index: number) => {
          item.itemSeqId = `1000${index + 1}`;
          item.quantity = item.quantityAccepted;
        });

        const params = {
          orderId: payload.orderId,
          destinationFacilityId: useProductStore().getCurrentFacility.facilityId,
          type: "PURCHASE_SHIPMENT",
          status: "PURCH_SHIP_CREATED",
          items: payload.items,
        };
        resp = await api({
          url: "/service/createIncomingShipment",
          method: "POST",
          data: { payload: params },
        });

        if (resp.status === 200 && !commonUtil.hasError(resp) && resp.data.shipmentId) {
          const productStore = useProductStore();
          const facilityLocations = await productStore.getFacilityLocations(useProductStore().getCurrentFacility.facilityId);
          if (facilityLocations.length) {
            const locationSeqId = facilityLocations[0].locationSeqId;
            payload.items.map((item: any) => {
              item.locationSeqId = locationSeqId;
              item.quantityReceived = item.quantityAccepted ? Number(item.quantityAccepted) : 0;
            });
          } else {
            commonUtil.showToast(
              translate(
                "Facility locations were not found corresponding to destination facility of PO. Please add facility locations to avoid receive PO failure."
              )
            );
          }
          const poShipment = {
            shipmentId: resp.data.shipmentId,
            items: payload.items,
            isMultiReceivingEnabled: true,
          };
          const shipmentStore = useShipmentStore();
          return await shipmentStore.receiveShipmentJson(poShipment).catch((err: any) => console.error(err));
        } else {
          commonUtil.showToast(translate("Something went wrong"));
        }
      } catch (error) {
        console.error(error);
        commonUtil.showToast(translate("Something went wrong"));
      }
      return false;
    },

    async getPOHistory(payload: any) {
      let resp: any;
      let viewIndex = 0;
      const viewSize = 250;
      let currentPOHistory = [] as Array<any>;
      let locationSeqId = "";
      try {
        const productStore = useProductStore();
        const facilityLocations = await productStore.getFacilityLocations(useProductStore().getCurrentFacility.facilityId);
        locationSeqId = facilityLocations.length > 0 ? facilityLocations[0].locationSeqId : "";

        do {
          const params = {
            inputFields: {
              orderId: [payload.orderId],
              orderId_op: "in",
            },
            entityName: "ShipmentReceiptAndItem",
            fieldList: [
              "datetimeReceived",
              "productId",
              "quantityAccepted",
              "quantityRejected",
              "receivedByUserLoginId",
              "shipmentId",
              "locationSeqId",
            ],
            orderBy: "datetimeReceived DESC",
            viewSize,
            viewIndex,
          };
          resp = await api({
            url: "/performFind",
            method: "POST",
            data: params,
          });
          if (resp.status === 200 && !commonUtil.hasError(resp) && resp.data?.docs.length > 0) {
            currentPOHistory = [...currentPOHistory, ...resp.data.docs];
          }
          viewIndex++;
        } while (resp?.data?.docs?.length >= viewSize);
      } catch (error) {
        console.error(error);
        currentPOHistory = [];
        this.current.poHistory.items = [];
      }

      this.current.poHistory.items = currentPOHistory;
      if (this.current.poHistory.items.length) {
        const receiversLoginIds = [
          ...new Set(this.current.poHistory.items.map((item: any) => item.receivedByUserLoginId)),
        ];
        const partyStore = usePartyStore();
        const receiversDetails = await partyStore.getReceiversDetails(receiversLoginIds);
        this.current.poHistory.items.map((item: any) => {
          item.receiversFullName = receiversDetails[item.receivedByUserLoginId]?.fullName || item.receivedByUserLoginId;
        });
      }

      const facilityLocationByProduct = this.current.poHistory.items.reduce((products: any, item: any) => {
        products[item.productId] = item.locationSeqId;
        return products;
      }, {});

      this.current.items.forEach((item: any) => {
        item.locationSeqId = facilityLocationByProduct[item.productId] ? facilityLocationByProduct[item.productId] : locationSeqId;
      });

      return resp;
    },
    async updatePOItemStatus(payload: any) {
      return api({
        url: "service/changeOrderItemStatus",
        method: "POST",
        data: payload,
      });
    },
    setItemLocationSeqId(payload: any) {
      const item = this.current.items.find((item: any) => item.orderItemSeqId === payload.item.orderItemSeqId);
      if (item) {
        item.locationSeqId = payload.locationSeqId;
      }
    },
    updateCurrentOrder(payload: any) {
      this.current = payload;
    },
    clearPurchaseOrders() {
      this.purchaseOrders = {
        list: [],
        total: 0,
      };
    },
    updatePurchaseOrders(payload: any) {
      this.purchaseOrders = {
        list: payload.purchaseOrders,
        total: payload.total ? payload.total : this.purchaseOrders.total,
      };
    },
  },
  persist: true,
});
