{
    'name': 'X2Many Search Bar',
    'version': '18.0.1.0.0',
    'summary': ' Adds a live search bar above any One2many or Many2many list in form views',
    'category': 'Technical',
    'author': 'ranthox18',
    'website': 'https://www.ranthox.com',
    'depends': ['web'],
    'assets': {
        'web.assets_backend': [
            'x2many_searchbar/static/src/xml/searchable_x2many.xml',
            'x2many_searchbar/static/src/js/searchable_x2many.js',
        ],
    },
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
