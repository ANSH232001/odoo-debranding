/** @odoo-module **/
/**
 * Searchable X2Many field widget. (Odoo 16 build)
 *
 * Drop-in replacement for the standard one2many / many2many list widget that
 * renders a live search bar above the list.  Works entirely client-side via
 * DOM filtering – no Python changes required.
 *
 * Usage:
 *   <field name="my_o2m" widget="searchable_x2many"/>
 *
 * Options (all optional):
 *   placeholder    – input placeholder text  (default: "Search…")
 *   search_columns – 0-based column indices to restrict search to;
 *                    omit to search all columns
 *
 * Example:
 *   <field name="my_o2m" widget="searchable_x2many"
 *          options="{'placeholder': 'Search by name…', 'search_columns': [0, 1]}"/>
 *
 * NOTE (Odoo 16 vs 17):
 * In Odoo 16 the fields registry stores the raw Component class directly
 * (registry.category("fields").add("many2many", X2ManyField)), and
 * "extractProps" is a *static property on that class itself*
 * (X2ManyField.extractProps = (...) => {...}).
 * There is NO separate exported "x2ManyField" descriptor object
 * ({component, extractProps, ...}) like there is from Odoo 17 onward.
 * Importing that name from 16 silently resolves to `undefined`, which is
 * exactly what produced the "Cannot read properties of undefined
 * (reading 'extractProps')" crash.
 */
import { X2ManyField } from "@web/views/fields/x2many/x2many_field";
import { useState, useRef, onMounted, onPatched } from "@odoo/owl";
import { registry } from "@web/core/registry";

export class SearchableX2ManyField extends X2ManyField {
    setup() {
        super.setup();
        this.searchState = useState({ term: "" });
        this.tableRef = useRef("searchable_table");
        onMounted(() => this._applyFilter());
        onPatched(() => this._applyFilter());
    }

    _applyFilter() {
        const term = this.searchState.term.toLowerCase().trim();
        const container = this.tableRef.el;
        if (!container) return;

        const cols = this.props.searchColumns || null;
        const rows = container.querySelectorAll("tr.o_data_row");

        for (const row of rows) {
            // Never hide a row that is currently being inline-edited.
            if (row.classList.contains("o_selected_row")) {
                row.style.display = "";
                continue;
            }
            if (!term) {
                row.style.display = "";
                continue;
            }

            let text;
            if (cols) {
                const cells = row.querySelectorAll("td");
                text = cols
                    .map((i) => (cells[i] ? cells[i].textContent : ""))
                    .join(" ")
                    .toLowerCase();
            } else {
                text = row.textContent.toLowerCase();
            }

            row.style.display = text.includes(term) ? "" : "none";
        }
    }

    onSearchInput(ev) {
        this.searchState.term = ev.target.value;
        this._applyFilter();
    }

    clearSearch() {
        this.searchState.term = "";
        this._applyFilter();
    }
}

// --- Odoo 16 static field metadata (assigned directly on the class,
//     mirroring how core/addons/web/static/src/views/fields/x2many/x2many_field.js
//     itself declares X2ManyField.props / X2ManyField.extractProps in 16.0) ---

SearchableX2ManyField.template = "x2many_searchbar.SearchableX2ManyField";
SearchableX2ManyField.components = X2ManyField.components;
SearchableX2ManyField.props = {
    ...X2ManyField.props,
    searchPlaceholder: { type: String, optional: true },
    searchColumns: { type: Array, optional: true },
};

// Delegate to the base X2ManyField.extractProps (addLabel, etc.) then append
// the widget-specific options parsed from options="{...}" on the <field/> tag.
SearchableX2ManyField.extractProps = ({ attrs, field }) => {
    return {
        ...X2ManyField.extractProps({ attrs, field }),
        searchPlaceholder: attrs.options && attrs.options.placeholder,
        searchColumns: attrs.options && attrs.options.search_columns,
    };
};

// Register the RAW component class, exactly like core does for
// "one2many" / "many2many" — Odoo 16's registry does NOT expect a
// {component, extractProps} wrapper object.
registry.category("fields").add("searchable_x2many", SearchableX2ManyField);