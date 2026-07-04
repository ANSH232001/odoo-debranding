from odoo import fields, models


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    photo_capture = fields.Binary(string="Photograph", attachment=True)
