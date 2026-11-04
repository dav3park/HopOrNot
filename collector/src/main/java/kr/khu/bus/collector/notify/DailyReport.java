package kr.khu.bus.collector.notify;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import kr.khu.bus.collector.collect.QuotaGuard;
import kr.khu.bus.collector.config.CollectionSchedule;
import kr.khu.bus.collector.config.CollectorProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** collector.report-cron 시각마다 오늘 0시부터 지금까지의 수집 현황을 보낸다. */
@Component
public class DailyReport {

    private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");
    private static final DateTimeFormatter MD_HM = DateTimeFormatter.ofPattern("MM/dd HH:mm");
    private static final long STALE_MINUTES = 30;

    private final JdbcTemplate jdbc;
    private final QuotaGuard quota;
    private final Notifier notifier;
    private final CollectionSchedule schedule;
    private final CollectorProperties props;
    private final ZoneId zone;

    public DailyReport(JdbcTemplate jdbc, QuotaGuard quota, Notifier notifier,
                       CollectionSchedule schedule, CollectorProperties props) {
        this.jdbc = jdbc;
        this.quota = quota;
        this.notifier = notifier;
        this.schedule = schedule;
        this.props = props;
        this.zone = ZoneId.of(props.zone());
    }

    @Scheduled(cron = "${collector.report-cron:0 10 9,15,22 * * *}", zone = "Asia/Seoul")
    public void report() {
        ZonedDateTime now = ZonedDateTime.now(zone);
        LocalDate today = now.toLocalDate();
        ZonedDateTime from = today.atStartOfDay(zone);
        boolean collecting = schedule.intervalAt(now.toLocalTime()).isPresent();

        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT route_id,
                       count(*)                                    AS obs,
                       count(DISTINCT veh_id)                      AS vehicles,
                       count(*) FILTER (WHERE remain_seat_cnt = 0) AS full_cnt,
                       count(*) FILTER (WHERE remain_seat_cnt < 0) AS missing,
                       max(collected_at)                           AS last_at
                FROM bus_observation
                WHERE collected_at >= ? AND collected_at < ?
                GROUP BY route_id
                """, from.toOffsetDateTime(), now.toOffsetDateTime());

        StringBuilder sb = new StringBuilder("📊 ").append(now.format(MD_HM))
                .append(" 수집 현황 (오늘 0시부터)\n");
        for (CollectorProperties.Route r : props.routes()) {
            Map<String, Object> row = rows.stream()
                    .filter(m -> ((Number) m.get("route_id")).longValue() == r.routeId())
                    .findFirst().orElse(null);
            if (row == null) {
                sb.append("- ").append(r.name()).append(": 관측 0건 ⚠️\n");
                continue;
            }
            Instant last = toInstant(row.get("last_at"));
            long ago = last == null ? -1 : Duration.between(last, now.toInstant()).toMinutes();
            boolean stale = collecting && (last == null || ago > STALE_MINUTES);
            sb.append("- ").append(r.name())
                    .append(": 관측 ").append(row.get("obs"))
                    .append("건, 차량 ").append(row.get("vehicles"))
                    .append("대, 만석 ").append(row.get("full_cnt")).append("건");
            if (((Number) row.get("missing")).longValue() > 0) {
                sb.append(", 좌석정보 없음 ").append(row.get("missing")).append("건");
            }
            if (last != null) {
                sb.append(", 마지막 ").append(last.atZone(zone).format(HM))
                        .append(" (").append(ago).append("분 전)");
            }
            sb.append(stale ? " ⚠️ 수집 지연\n" : "\n");
        }
        sb.append("- 위치정보 호출 ").append(quota.used("location", today))
                .append(" / ").append(quota.dailyLimit()).append("회");
        notifier.info("status-" + now.truncatedTo(ChronoUnit.HOURS), sb.toString());
    }

    private static Instant toInstant(Object v) {
        if (v instanceof Timestamp t) return t.toInstant();
        if (v instanceof OffsetDateTime o) return o.toInstant();
        return null;
    }
}