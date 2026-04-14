import { defineStore } from "pinia";
import { api, commonUtil } from "@common";

export const useUtilStore = defineStore("util", {
  state: () => ({
    status: {} as any,
  }),
  getters: {
    getStatusDesc: (state) => (statusId: string) => state.status[statusId],
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
        const resp: any = await api({
          url: "/performFind",
          method: "post",
          baseURL: commonUtil.getOmsURL(),
          data: {
            entityName: "StatusItem",
            noConditionFind: "Y",
            distinct: "Y",
            viewSize: statusIdFilter.length,
            inputFields: {
              statusId: statusIdFilter,
              statusId_op: "in",
            },
            fieldList: ["statusId", "description"],
          },
        });
        if (resp.status === 200 && !commonUtil.hasError(resp) && resp.data?.count) {
          const statuses = resp.data.docs;
          statuses.reduce((cached: any, status: any) => {
            cached[status.statusId] = status.description;
            return cached;
          }, cachedStatus);
          this.status = cachedStatus;
        }
      } catch (err) {
        console.error("Something went wrong while fetching status");
      }
      return cachedStatus;
    },

    async fetchShopifyShopLocation(token: string, payload: any) {
      return api({
        url: "performFind",
        method: "post",
        baseURL: commonUtil.getOmsURL(),
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        data: payload,
      });
    },
  },
  persist: true,
});
