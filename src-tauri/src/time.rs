use chrono::{DateTime, Datelike, FixedOffset};

use crate::error::{AppError, Result};

/// Parses an RFC 3339 timestamp that carries the device's local UTC offset.
pub fn parse(ts: &str) -> Result<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(ts)
        .map_err(|_| AppError::Invalid(format!("not a valid timestamp: {ts}")))
}

/// The calendar day the user experienced, `YYYY-MM-DD`.
pub fn local_day(ts: &str) -> Result<String> {
    Ok(parse(ts)?.format("%Y-%m-%d").to_string())
}

/// The ISO week a local day falls in, `2026-W37` — the same key the UI uses.
pub fn iso_week(day: &str) -> Result<String> {
    let date = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .map_err(|_| AppError::Invalid(format!("not a valid day: {day}")))?;
    let week = date.iso_week();
    Ok(format!("{}-W{:02}", week.year(), week.week()))
}

/// The day after `day`, as `YYYY-MM-DD`.
pub fn next_day(day: &str) -> Result<String> {
    let date = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .map_err(|_| AppError::Invalid(format!("not a valid day: {day}")))?;
    Ok((date + chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string())
}

pub fn local_month(day: &str) -> String {
    day.chars().take(7).collect()
}

pub fn hhmm(ts: &str) -> Result<String> {
    Ok(parse(ts)?.format("%H:%M").to_string())
}

pub fn duration_seconds(start: &str, end: &str) -> Result<i64> {
    Ok((parse(end)? - parse(start)?).num_seconds())
}

/// Rounds to a multiple of `minutes`, never collapsing real work to zero.
pub fn round_seconds(seconds: i64, minutes: u32) -> i64 {
    if minutes == 0 || seconds <= 0 {
        return seconds.max(0);
    }
    let step = minutes as i64 * 60;
    let rounded = ((seconds + step / 2) / step) * step;
    rounded.max(step)
}

/// `1h 30m`, `45m`, `0m` — short enough for a table cell, readable at a glance.
pub fn format_duration(seconds: i64) -> String {
    let seconds = seconds.max(0);
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    if hours > 0 {
        format!("{hours}h {minutes:02}m")
    } else {
        format!("{minutes}m")
    }
}

/// Decimal hours with two digits — what invoicing tools and Dataview want.
pub fn decimal_hours(seconds: i64) -> f64 {
    (seconds.max(0) as f64 / 36.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_local_day_regardless_of_offset() {
        // 00:30 in Tokyo is still "today" for the person holding the phone,
        // even though it is yesterday in UTC.
        assert_eq!(
            local_day("2026-09-08T00:30:00+09:00").unwrap(),
            "2026-09-08"
        );
        assert_eq!(
            local_day("2026-09-08T23:30:00-07:00").unwrap(),
            "2026-09-08"
        );
    }

    #[test]
    fn measures_across_offsets() {
        let secs =
            duration_seconds("2026-09-08T09:00:00+02:00", "2026-09-08T08:30:00+00:00").unwrap();
        assert_eq!(secs, 5400);
    }

    #[test]
    fn rounding_never_swallows_a_session() {
        assert_eq!(round_seconds(60, 15), 900);
        assert_eq!(round_seconds(14 * 60, 15), 900);
        assert_eq!(round_seconds(23 * 60, 15), 1800);
        assert_eq!(round_seconds(3600, 0), 3600);
        assert_eq!(round_seconds(-5, 15), 0);
    }

    #[test]
    fn iso_weeks_match_the_calendar() {
        assert_eq!(iso_week("2026-09-08").unwrap(), "2026-W37");
        // A Sunday belongs to the week that started on the Monday before it.
        assert_eq!(iso_week("2026-09-13").unwrap(), "2026-W37");
        assert_eq!(iso_week("2026-09-14").unwrap(), "2026-W38");
        // The turn of the year is where naive week numbering falls apart.
        assert_eq!(iso_week("2027-01-01").unwrap(), "2026-W53");
    }

    #[test]
    fn formats_durations() {
        assert_eq!(format_duration(0), "0m");
        assert_eq!(format_duration(2700), "45m");
        assert_eq!(format_duration(5400), "1h 30m");
        assert_eq!(format_duration(36000 + 300), "10h 05m");
    }

    #[test]
    fn decimal_hours_round_to_two_digits() {
        assert_eq!(decimal_hours(5400), 1.5);
        assert_eq!(decimal_hours(2700), 0.75);
        assert_eq!(decimal_hours(60), 0.02);
    }
}
