import pytest

from mpesa_core.errors import (
    AttestationError,
    CoreError,
    DomainRowError,
    ErrorCode,
    ExtractionError,
)

# Fake row values, assembled so this file holds no receipt-shaped literal.
PLANTED_VALUES = ["ZZ" + "AB12CD34", "Example Person 07", "1,234.50", "Example Till 012"]
EXPECTED_CODES = {
    "LAYOUT_UNRECOGNIZED",
    "NOT_A_PDF",
    "PASSWORD_REQUIRED",
    "PASSWORD_INCORRECT",
    "CORRUPT_PDF",
    "TOO_LARGE",
    "TOO_MANY_PAGES",
    "TIMEOUT",
}


def test_every_error_code_exists():
    assert {code.name for code in ErrorCode} == EXPECTED_CODES


@pytest.mark.parametrize("code", list(ErrorCode), ids=lambda code: code.name)
def test_extraction_error_message_states_its_code(code):
    assert code.value in str(ExtractionError(code))


def test_extraction_error_keeps_its_code_for_the_bridge():
    assert ExtractionError(ErrorCode.TIMEOUT).code is ErrorCode.TIMEOUT


def test_extraction_error_can_state_a_page_position():
    error = ExtractionError(ErrorCode.CORRUPT_PDF, page=3)
    assert error.page == 3
    assert "page 3" in str(error)


def test_domain_row_error_states_its_row_index():
    error = DomainRowError(12)
    assert error.row_index == 12
    assert "row 12" in str(error)


def test_attestation_error_can_state_counts():
    error = AttestationError(expected_count=6, found_count=4)
    assert "expected 6" in str(error)
    assert "found 4" in str(error)


def test_every_error_is_a_core_error():
    assert issubclass(ExtractionError, CoreError)
    assert issubclass(AttestationError, CoreError)
    assert issubclass(DomainRowError, CoreError)


@pytest.mark.parametrize("planted", PLANTED_VALUES)
def test_extraction_error_rejects_a_string_code(planted):
    with pytest.raises(TypeError) as caught:
        ExtractionError(planted)
    assert planted not in str(caught.value)


def test_extraction_error_rejects_the_code_name_as_a_string():
    with pytest.raises(TypeError):
        ExtractionError("TIMEOUT")


@pytest.mark.parametrize("planted", PLANTED_VALUES)
def test_extraction_error_rejects_a_string_page(planted):
    with pytest.raises(TypeError) as caught:
        ExtractionError(ErrorCode.CORRUPT_PDF, page=planted)
    assert planted not in str(caught.value)


@pytest.mark.parametrize("planted", PLANTED_VALUES)
def test_domain_row_error_rejects_a_string_row_index(planted):
    with pytest.raises(TypeError) as caught:
        DomainRowError(planted)
    assert planted not in str(caught.value)


@pytest.mark.parametrize("planted", PLANTED_VALUES)
def test_attestation_error_rejects_string_counts(planted):
    with pytest.raises(TypeError) as caught:
        AttestationError(expected_count=planted)
    assert planted not in str(caught.value)
    with pytest.raises(TypeError) as caught:
        AttestationError(found_count=planted)
    assert planted not in str(caught.value)


@pytest.mark.parametrize("bad", [True, 1.5, None, b"x", [1]], ids=repr)
def test_domain_row_error_accepts_only_a_real_integer(bad):
    with pytest.raises(TypeError):
        DomainRowError(bad)


def test_negative_position_is_rejected():
    with pytest.raises(ValueError, match="row_index"):
        DomainRowError(-1)


@pytest.mark.parametrize(
    "build",
    [
        lambda planted: ExtractionError(ErrorCode.CORRUPT_PDF, planted),
        lambda planted: ExtractionError(ErrorCode.CORRUPT_PDF, details=planted),
        lambda planted: DomainRowError(1, planted),
        lambda planted: DomainRowError(1, details=planted),
        lambda planted: AttestationError(planted),
    ],
    ids=["extra-positional", "extra-keyword", "row-positional", "row-keyword", "attest-positional"],
)
def test_no_constructor_has_a_way_to_take_free_text(build):
    planted = PLANTED_VALUES[0]
    with pytest.raises(TypeError) as caught:
        build(planted)
    assert planted not in str(caught.value)


@pytest.mark.parametrize("planted", PLANTED_VALUES)
def test_a_planted_value_in_the_cause_stays_out_of_the_message(planted):
    with pytest.raises(DomainRowError) as caught:
        try:
            raise ValueError(f"cannot parse {planted}")
        except ValueError as error:
            raise DomainRowError(4) from error
    assert planted in str(caught.value.__cause__)
    assert planted not in str(caught.value)
    assert planted not in repr(caught.value)
    assert all(planted not in str(argument) for argument in caught.value.args)
