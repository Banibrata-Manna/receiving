import { defineStore } from "pinia";
import { api } from "@/adapter";
import { hasError } from "@/utils";

export const usePartyStore = defineStore("party", {
  state: () => ({
    namesByLoginId: {} as any,
  }),
  getters: {},
  actions: {
    async getReceiversDetails(receiversLoginIds: any) {
      const unavailableReceiversLoginIds = receiversLoginIds.filter((receiversLoginId: any) => !this.namesByLoginId[receiversLoginId]);

      if (!unavailableReceiversLoginIds.length) return this.namesByLoginId;

      let resp: any;
      const params = {
        inputFields: {
          userLoginId: unavailableReceiversLoginIds,
          userLoginId_op: "in",
        },
        fieldList: ["firstName", "lastName", "userLoginId"],
        entityName: "PartyAndUserLoginAndPerson",
        viewSize: unavailableReceiversLoginIds.length,
        noConditionFind: "Y",
      };
      try {
        resp = await api({
          url: "performFind",
          method: "post",
          data: params,
        });
        if (resp.status == 200 && !hasError(resp) && resp.data.count > 0) {
          const receiversDetails = resp.data.docs;

          receiversDetails.forEach((receiverDetails: any) => {
            receiverDetails.fullName = [receiverDetails.firstName, receiverDetails.lastName].filter(Boolean).join(" ");
            this.namesByLoginId[receiverDetails.userLoginId] = receiverDetails;
          });
        } else {
          console.error(resp);
        }
      } catch (err) {
        console.error(err);
      }
      return this.namesByLoginId;
    },
    async resetReceiversDetails() {
      this.namesByLoginId = {};
    },
  },
  persist: true,
});
