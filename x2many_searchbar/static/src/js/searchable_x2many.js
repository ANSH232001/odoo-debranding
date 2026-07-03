/** @odoo-module **/
/**
 * Searchable X2Many field widget.
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
 */
import { X2ManyField, x2ManyField } from "@web/views/fields/x2many/x2many_field";
import { useState, useRef, onMounted, onPatched } from "@odoo/owl";
import { registry } from "@web/core/registry";

export class SearchableX2ManyField extends X2ManyField {
    static template = "x2many_searchbar.SearchableX2ManyField";
    static props = {
        ...X2ManyField.props,
        // Injected via extractProps from the field's options="..." attribute
        searchPlaceholder: { type: String, optional: true },
        searchColumns: { type: Array, optional: true },
    };

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

export const searchableX2ManyField = {
    ...x2ManyField,
    component: SearchableX2ManyField,
    // Delegate to the base extractProps (which supplies context, domain, views,
    // etc.) then append the widget-specific options.
    extractProps(fieldInfo, dynamicInfo) {
        return {
            ...x2ManyField.extractProps(fieldInfo, dynamicInfo),
            searchPlaceholder: fieldInfo.options?.placeholder,
            searchColumns: fieldInfo.options?.search_columns,
        };
    },
};

registry.category("fields").add("searchable_x2many", searchableX2ManyField);
