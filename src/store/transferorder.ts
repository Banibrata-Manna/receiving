import { defineStore } from "pinia";
import { TransferOrderService } from "@/services/TransferOrderService";
import { hasError } from "@/adapter";
import { showToast } from "@/utils";
import { getProductIdentificationValue, translate } from "@hotwax/dxp-components";
import { useUtilStore } from "@/store/util";
import { useProductStore } from "@/store/product";
import { usePartyStore } from "@/store/party";

export const useTransferOrderStore = defineStore("transferorder", {
  state: () => ({
    transferOrder: {
      list: [] as any,
      total: 0,
      query: {
        viewIndex: 0,
        viewSize: process.env.VITE_APP_VIEW_SIZE || 10,
        queryString: "",
        selectedShipmentMethods: [] as Array<string>,
        selectedStatuses: [] as Array<string>,
      },
    },
    current: {
      items: [] as any,
      toHistory: {
        items: [] as any,
      },
      shipmentHistory: {
        items: [] as any,
      },
    } as any,
    misShippedItems: [] as any,
  }),
  getters: {
    getTransferOrders: (state) => state.transferOrder,
    getCurrent: (state) => state.current,
    getTOHistory: (state) => state.current.toHistory,
    isProductAvailableInOrder: (state) => (productId: string) => state.current.items.some((item: any) => item.productId === productId),
    getShipmentHistory: (state) => state.current.shipmentHistory,
    getMisShippedItems: (state) => state.misShippedItems,
  },
  actions: {
    async fetchTransferOrders(params: any = {}) {
      let resp;
      const transferOrderQuery = JSON.parse(JSON.stringify(this.transferOrder.query));
      let orders = [];
      let total = 0;

      try {
        resp = await TransferOrderService.fetchTransferOrders(params);
        if (!hasError(resp) && resp.data.orders.length > 0) {
          total = resp.data.ordersCount;
          if (params.pageIndex && params.pageIndex > 0) {
            orders = this.transferOrder.list.concat(resp.data.orders);
          } else {
            orders = resp.data.orders;
          }
          this.transferOrder = { list: orders, total, query: transferOrderQuery };
        } else {
          if (params.pageIndex && params.pageIndex > 0) {
            showToast(translate("Transfer orders not found"));
          } else {
            this.transferOrder = { list: [], total: 0, query: transferOrderQuery };
          }
        }
      } catch (err) {
        console.error("No transfer orders found", err);
        showToast(translate("Something went wrong"));
        this.transferOrder = { list: [], total: 0, query: transferOrderQuery };
      }
      return resp;
    },

    async fetchMisShippedItems(payload: any) {
      let misShippedItems: any = [];
      const orderId = payload.orderId;

      try {
        const resp = await TransferOrderService.fetchMisShippedItems({
          orderId,
          pageSize: 200,
        });
        if (!hasError(resp) && resp.data?.length) {
          misShippedItems = resp.data.map((item: any) => ({
            ...item,
            statusId: "ITEM_COMPLETED",
          }));
        }
      } catch (error) {
        console.error(error);
      }

      this.misShippedItems = misShippedItems;
    },

    async fetchTransferOrderDetail(payload: any) {
      let resp;
      let order: any = {};
      const orderId = payload.orderId;
      const misShippedItems = this.getMisShippedItems;

      try {
        resp = await TransferOrderService.fetchTransferOrderDetail(orderId);

        if (resp.status === 200 && !hasError(resp) && resp.data.order) {
          order = resp.data.order;
          order.items = order.items.concat(misShippedItems);

          const trackingResp = await TransferOrderService.fetchOrderTrackingDetails(orderId);
          if (!hasError(trackingResp) && trackingResp.data) {
            order.shipmentPackages = trackingResp.data.shipmentPackages;
          } else {
            order.shipmentPackages = [];
          }

          if (order.items && order.items.length) {
            const productStore = useProductStore();
            productStore.fetchProductInformation({ order: order.items });
          }
        }
      } catch (error) {
        console.error(error);
      }

      this.current = order;
      return resp;
    },

    async updateProductCount(payload: any) {
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
        if (item.statusId === "ITEM_COMPLETED") return { isCompleted: true };

        item.quantityAccepted = Number(item.quantityAccepted) ? Number(item.quantityAccepted) + 1 : 1;
        return { isProductFound: true };
      }

      return { isProductFound: false };
    },

    async addOrderItem(payload: any) {
      const product = {
        ...payload,
        quantityAccepted: 0,
        quantity: 0,
      };
      this.current.items.push(product);
    },

    async fetchTOHistory({ payload }: { payload: any }) {
      const pageSize = process.env.VITE_APP_VIEW_SIZE || 10;
      const misShippedItems = this.getMisShippedItems;
      let pageIndex = 0;
      let allHistory: any[] = [];
      let resp;

      try {
        do {
          resp = await TransferOrderService.fetchTransferOrderHistory({
            ...payload,
            pageSize,
            pageIndex,
          });
          if (!hasError(resp) && resp.data.length > 0) {
            allHistory = allHistory.concat(resp.data);
            pageIndex++;
          }
        } while (resp.data.length >= pageSize);

        if (misShippedItems?.length) {
          allHistory.push(...misShippedItems);
        }

        if (allHistory.length > 0) {
          const receiversLoginIds = [...new Set(allHistory.map((item: any) => item.receivedByUserLoginId))];
          const partyStore = usePartyStore();
          const receiversDetails = await partyStore.getReceiversDetails(receiversLoginIds);
          allHistory.forEach((item: any) => {
            item.receiversFullName = receiversDetails[item.receivedByUserLoginId]?.fullName || item.receivedByUserLoginId;
          });
          this.current.toHistory = { items: allHistory };
        } else {
          this.current.toHistory = { items: [] };
        }
      } catch (error) {
        console.error(error);
        this.current.toHistory = { items: [] };
      }
      return allHistory;
    },

    async fetchOutboundShipmentsHistory(params: any) {
      let resp;
      const payload = { ...params, shipmentStatusId: "SHIPMENT_SHIPPED" };
      try {
        resp = await TransferOrderService.fetchOutboundShipmentsHistory(payload);
        if (!hasError(resp)) {
          const shipmentData = resp.data.shipments || [];

          const shipmentDetails = shipmentData.flatMap((shipment: any) => {
            return shipment.packages.flatMap((pkg: any) => {
              return pkg.items.map((item: any) => ({
                statusDate: shipment.statusDate,
                shipmentId: shipment.shipmentId,
                orderId: shipment.orderId,
                shipmentStatus: shipment.shipmentStatusId,
                packageSeqId: pkg.shipmentPackageSeqId,
                trackingCode: pkg.trackingCode,
                ...item,
              }));
            });
          });
          this.current.shipmentHistory = { items: shipmentDetails };
        } else {
          throw resp.data;
        }
      } catch (err) {
        console.error("No transfer Shipment found", err);
        this.current.shipmentHistory = { items: [] };
      }
      return resp;
    },

    clearTransferOrderDetail() {
      this.current = {
        items: [],
        toHistory: { items: [] },
        shipmentHistory: { items: [] },
      };
    },
  },
  persist: true,
});
