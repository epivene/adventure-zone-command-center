# Profile booking-decision redesign

Approved scope: the owner/admin `/profiles` directory and `/profiles/:id` detail view.

The directory keeps its existing URL-backed search, filters, pagination, routes, and set-based enrichment. Cards prioritize event identity, location, next published date, one pipeline status, a manually recorded deal recommendation, and the next recorded action. Four quick-filter chips write to the same directory query. Selection opens the existing responsive profile sheet while retaining a full-page link.

The detail view adds one shared At a glance component before history. It derives dates and follow-ups only from canonical records, uses explicit empty states, and explains the three deal structures without profitability claims.

Two nullable organization columns are added: `application_deadline` and `recommended_deal_model`. Existing data is unchanged. The latter is constrained to `flat_fee`, `pay_per_play`, or `either`. Both fields are editable through the existing inline profile action.

CSV export runs on the server because the directory is paginated and applies the same parsed filters as the screen.
