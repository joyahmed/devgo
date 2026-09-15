use crate::services::preferences::ProjectStat;

const DAY: u64 = 60 * 60 * 24;

/// Recency multiplier, bucketed rather than a smooth curve.
///
/// Buckets are deliberate: a continuous decay makes the list reshuffle slightly
/// every few minutes, which is worse than useless in a launcher you navigate by
/// muscle memory. Within a bucket the order is stable all day.
fn recency_weight(age_secs: u64) -> f64 {
    match age_secs {
        a if a < DAY => 8.0,
        a if a < 3 * DAY => 4.0,
        a if a < 7 * DAY => 2.0,
        a if a < 30 * DAY => 1.0,
        _ => 0.5,
    }
}

/// Frequency × recency, with frequency damped logarithmically.
///
/// The damping is the whole trick. Multiplying raw counts lets history win:
/// 20 launches a month ago (20 × 0.5 = 10) would outrank one this morning
/// (1 × 8 = 8), which is precisely backwards for a launcher. `1 + ln(count)`
/// makes the 20th launch worth far less than the 2nd, so recency dominates
/// while frequency still breaks ties.
pub fn score(stat: &ProjectStat, now: u64) -> f64 {
    if stat.launch_count == 0 {
        return 0.0;
    }
    let age = now.saturating_sub(stat.last_opened);
    let frequency = 1.0 + f64::from(stat.launch_count).ln();
    frequency * recency_weight(age)
}

/// The hint shown on a row. `None` for the long tail, so the badges stay
/// meaningful instead of decorating every line.
pub fn hint(stat: &ProjectStat, now: u64) -> Option<&'static str> {
    if stat.launch_count == 0 {
        return None;
    }
    let age = now.saturating_sub(stat.last_opened);
    if age < 3 * DAY {
        Some("recent")
    } else if stat.launch_count >= 5 {
        Some("frequent")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stat(count: u32, age_days: u64) -> ProjectStat {
        ProjectStat {
            launch_count: count,
            last_opened: 1_000 * DAY - age_days * DAY,
        }
    }

    const NOW: u64 = 1_000 * DAY;

    #[test]
    fn recency_beats_raw_count() {
        let today_once = score(&stat(1, 0), NOW);
        let last_month_twenty = score(&stat(20, 31), NOW);
        assert!(
            today_once > last_month_twenty,
            "1 launch today ({today_once}) should outrank 20 a month ago ({last_month_twenty})"
        );
    }

    #[test]
    fn count_breaks_ties_within_a_bucket() {
        assert!(score(&stat(5, 0), NOW) > score(&stat(2, 0), NOW));
    }

    #[test]
    fn never_launched_scores_zero() {
        assert_eq!(score(&stat(0, 0), NOW), 0.0);
        assert_eq!(hint(&stat(0, 0), NOW), None);
    }

    /// A clock that jumped backwards must not panic or produce a wild score.
    /// saturating_sub clamps the age to 0, which lands in the freshest bucket.
    #[test]
    fn future_timestamp_is_survivable() {
        let future = ProjectStat {
            launch_count: 3,
            last_opened: NOW + 5 * DAY,
        };
        assert_eq!(score(&future, NOW), (1.0 + 3f64.ln()) * 8.0);
    }

    /// The damping must not be so strong that frequency stops mattering, nor so
    /// weak that a stale-but-popular project floats to the top.
    #[test]
    fn frequency_has_diminishing_returns() {
        let one = score(&stat(1, 0), NOW);
        let two = score(&stat(2, 0), NOW);
        let twenty = score(&stat(20, 0), NOW);
        assert!(two > one);
        assert!(twenty > two);
        // Doubling 1 → 2 should buy more than going 10 → 20 does.
        assert!(
            two - one > score(&stat(20, 0), NOW) - score(&stat(10, 0), NOW)
        );
    }

    #[test]
    fn hints_are_selective() {
        assert_eq!(hint(&stat(1, 0), NOW), Some("recent"));
        assert_eq!(hint(&stat(9, 10), NOW), Some("frequent"));
        // Opened twice, a week ago: real, but not worth a badge.
        assert_eq!(hint(&stat(2, 7), NOW), None);
    }
}
