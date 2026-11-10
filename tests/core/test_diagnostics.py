import logging

from synthetic_events import event_row

from mpesa_core.classification.classify import (
    ECONOMIC_MEANING_UNRESOLVED,
    ENTITY_EXTRACTION_UNRESOLVED,
    EVENT_CLASSIFICATION_UNRESOLVED,
    classify_transactions,
)


def diagnostics_of(rows):
    return classify_transactions(rows)[1]


def test_unresolved_row_is_returned_as_a_structured_diagnostic():
    # Was: a diagnostic event is written as a structured record.
    (event, meaning, entity) = diagnostics_of([event_row(0, "UNCLASSIFIED")])
    assert event == {
        "code": EVENT_CLASSIFICATION_UNRESOLVED,
        "row_index": 0,
        "details": event["details"],
    }
    assert (meaning["code"], meaning["row_index"]) == (ECONOMIC_MEANING_UNRESOLVED, 0)
    assert (entity["code"], entity["row_index"]) == (ENTITY_EXTRACTION_UNRESOLVED, 0)


def test_each_unresolved_row_is_a_separate_diagnostic_in_the_old_order():
    # Was: events are appended as separate records.
    rows = [
        event_row(0, "UNCLASSIFIED"),
        event_row(1, "AIRTIME_PURCHASE"),
        event_row(2, "UNCLASSIFIED"),
    ]
    found = [(diagnostic["code"], diagnostic["row_index"]) for diagnostic in diagnostics_of(rows)]
    assert found == [
        (EVENT_CLASSIFICATION_UNRESOLVED, 0),
        (EVENT_CLASSIFICATION_UNRESOLVED, 2),
        (ECONOMIC_MEANING_UNRESOLVED, 0),
        (ECONOMIC_MEANING_UNRESOLVED, 2),
        (ENTITY_EXTRACTION_UNRESOLVED, 0),
        (ENTITY_EXTRACTION_UNRESOLVED, 1),
        (ENTITY_EXTRACTION_UNRESOLVED, 2),
    ]


def test_diagnostics_are_returned_and_nothing_is_logged_or_written(caplog, tmp_path, monkeypatch):
    # Was: the log path may be given as a string. Nothing is written anywhere now.
    monkeypatch.chdir(tmp_path)
    with caplog.at_level(logging.DEBUG):
        diagnostics = diagnostics_of([event_row(0, "UNCLASSIFIED")])
    assert diagnostics
    assert caplog.records == []
    assert list(tmp_path.iterdir()) == []


def test_resolved_rows_give_no_diagnostics():
    assert diagnostics_of([event_row(0, "MERCHANT_PAYMENT")]) == []
