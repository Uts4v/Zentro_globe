def validate_insight_output(parsed, metrics: dict) -> list[str]:
    errors = []

    sales = metrics.get("sales", {})
    top_products = metrics.get("top_products", [])

    summary = (parsed.executive_summary or "").lower()
    for rec in parsed.recommendations:
        for evidence in rec.evidence:
            metric_name = evidence.metric.lower()
            val = evidence.value

            if "revenue" in metric_name or "sales" in metric_name:
                if not _check_metric_match(val, sales.get("today", 0)):
                    errors.append(
                        f"Recommendation '{rec.title}' references revenue {val} "
                        f"but actual is {sales.get('today', 0)}"
                    )

            if "order" in metric_name and "count" in metric_name:
                if not _check_metric_match(val, sales.get("order_count", 0)):
                    errors.append(
                        f"Order count mismatch: {val} vs {sales.get('order_count', 0)}"
                    )

    if top_products:
        top_names = {p["name"].lower() for p in top_products}
        for rec in parsed.recommendations:
            for evidence in rec.evidence:
                if "top" in evidence.metric.lower() and "product" in evidence.metric.lower():
                    if evidence.value.lower() not in top_names:
                        errors.append(
                            f"Top product '{evidence.value}' not in actual top products"
                        )

    return errors


def _check_metric_match(reported: str, actual: float | int) -> bool:
    try:
        reported_num = float(reported.replace("$", "").replace(",", "").replace("Rs", ""))
        return abs(reported_num - float(actual)) / max(float(actual), 1) < 0.1
    except (ValueError, AttributeError):
        return True
