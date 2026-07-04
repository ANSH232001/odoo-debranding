{
    'name': 'Sale Order Photo Capture',
    'version': '16.0.1.0.0',
    'summary': 'Capture photograph on sale orders using photograph_capture_widget',
    'category': 'Sales',
    'author': 'Ranthox Pty Ltd',
    'website': 'https://ranthox.odoo.com',
    'depends': ['sale', 'photograph_capture_widget'],
    'data': [
        'views/sale_order_views.xml',
    ],
    'installable': True,
    'auto_install': False,
    'license': 'LGPL-3',
}
