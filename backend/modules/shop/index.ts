export { registerShopModuleRoutes, type ShopModuleDeps } from './shop.controller.js';
export { buildShopStateV1 } from './shop.snapshot.service.js';
export { loadHardwareShopProducts, filterProductsForMinerShop } from './shop.catalog.js';
export {
  runHardwareCheckoutTransaction,
  parseHardwareCartOrError,
  type HardwareCheckoutResult
} from './shop.checkout.service.js';
export type { ShopStateV1Dto, ShopProductDto, ShopCartLineDto } from './shop.types.js';
