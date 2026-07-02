{
    'name': 'Excel Editor Widget',
    'version': '18.0.1.0.0',
    'summary': 'OWL widget to upload and view Excel files inline',
    'category': 'Hidden',
    'author': 'Ranthox Official',
    'website': 'https://ranthox.com',
    'license': 'Other proprietary',
    'depends': ['web'],
    'data': [],
    'assets': {
        'web.assets_backend': [
            'excel_editor_widget/static/lib/xlsx/xlsx.full.min.js',
            'excel_editor_widget/static/lib/jszip/jszip.min.js',
            'excel_editor_widget/static/lib/x-spreadsheet/xspreadsheet.css',
            'excel_editor_widget/static/lib/x-spreadsheet/xspreadsheet.js',
            'excel_editor_widget/static/src/xml/excel_editor_widget.xml',
            'excel_editor_widget/static/src/js/excel_editor_widget.js',
        ],
    },
    'installable': True,
    'application': False,
    'auto_install': False,
}
