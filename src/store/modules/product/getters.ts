import { GetterTree } from 'vuex'
import ProductState from './ProductState'
import RootState from '../../RootState'

const getters: GetterTree <ProductState, RootState> = {
  getProduct: (state) => (productId: string) => {
    return state.cached[productId] ? state.cached[productId] : {};
  },
  getProducts: (state) => {
    return state.list.items
  },
  isScrollable(state) {
    return (
      state.list.items.length > 0 &&
      state.list.items.length < state.list.total
    );
  },
}
export default getters