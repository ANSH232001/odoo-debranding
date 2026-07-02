from odoo import fields, models


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    excel_file = fields.Binary(string="Excel File", attachment=True)
    excel_file_filename = fields.Char(string="Excel Filename")
