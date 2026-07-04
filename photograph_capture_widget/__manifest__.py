{
    'name': 'Photograph Capture Widget',
    'version': '19.0.1.0.0',
    'summary': 'Reusable camera/photograph capture OWL field widget for binary image fields',
    'category': 'Technical',
    'author': 'Ranthox Pty Ltd',
    'website': 'https://ranthox.odoo.com',
    'depends': ['web'],
    'assets': {
        'web.assets_backend': [
            'photograph_capture_widget/static/src/xml/camera_capture.xml',
            'photograph_capture_widget/static/src/js/camera_capture.js',
            'photograph_capture_widget/static/src/xml/photograph_capture_widget.xml',
            'photograph_capture_widget/static/src/js/photograph_capture_widget.js',
        ],
    },
    'installable': True,
    'auto_install': False,
    'license': 'LGPL-3',
}
