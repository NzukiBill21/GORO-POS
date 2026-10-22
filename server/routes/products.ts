import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { productController } from '../controllers/productController.js';

export const productsRouter = Router();
productsRouter.use(authenticate);

productsRouter.get('/', requirePermission('products.view'), productController.list);
productsRouter.get('/export', requirePermission('products.view'), productController.export);
productsRouter.get('/barcode/:code', requirePermission('products.view'), productController.getByBarcode);
productsRouter.get('/:id', requirePermission('products.view'), productController.get);
productsRouter.post('/import', requirePermission('products.create'), productController.importProducts);
productsRouter.post('/', requirePermission('products.create'), productController.create);
productsRouter.post(
  '/:id/generate-barcode',
  requirePermission('products.edit'),
  productController.generateInternalBarcode
);
productsRouter.post('/:id/variants', requirePermission('products.edit'), productController.createVariant);
productsRouter.put('/:id/variants/:variantId', requirePermission('products.edit'), productController.updateVariant);
productsRouter.put('/:id', requirePermission('products.edit'), productController.update);
productsRouter.delete('/:id', requirePermission('products.delete'), productController.delete);
