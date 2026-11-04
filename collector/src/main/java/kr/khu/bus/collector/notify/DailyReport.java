package kr.khu.bus.collector.notify;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import kr.khu.bus.collector.collect.QuotaGuard;
import kr.khu.bus.collector.config.CollectorProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 매일 23:55에 그날 수집 요약을 남긴다 (디스코드 설정 시 전송). */
@Component
public class DailyReport {

    private final JdbcTemplate jdbc;
    private final QuotaGuard quota;
    private final Notifier notifier;
    private final ZoneId zone;
    private final CollectorProperties props;

    public DailyReport(JdbcTemplate jdbc, QuotaGuard quota, Notifier notifier, CollectorProperties props) {
        this.jdbc = jdbc;
        this.quota = quota;
        this.notifier = notifier;
        this.props = props;
        this.zone = ZoneId.of(props.zone());
    }

    @Scheduled(cron = "0 55 23 * * *", zone = "Asia/Seoul")
    public void report() {
        LocalDate today = LocalDate.now(zone);
        ZonedDateTime from = today.atStartOfDay(zone);
        ZonedDateTime to = from.plusDays(1);

        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT route_id,
                       count(*)                                         AS obs,
                       count(DISTINCT veh_id)                           AS vehicles,
                       count(*) FILTER (WHERE remain_seat_cnt < 0)      AS missing,
                       count(*) FILTER (WHERE remain_seat_cnt = 0)      AS full_cnt
                FROM bus_observation
                WHERE collected_at >= ? AND collected_at < ?
                GROUP BY route_id ORDER BY route_id
                """, from.toOffsetDateTime(), to.toOffsetDateTime());

        StringBuilder sb = new StringBuilder("📊 ").append(today).append(" 수집 요약\n");
        for (CollectorProperties.Route r : props.routes()) {
            Map<String, Object> row = rows.stream()
                    .filter(m -> ((Number) m.get("route_id")).longValue() == r.routeId())
                    .findFirst().orElse(null);
            if (row == null) {
                sb.append("- ").append(r.name()).append(": 관측 0건 ⚠️\n");
            } else {
                sb.append("- ").append(r.name())
                        .append(": 관측 ").append(row.get("obs"))
                        .append("건, 차량 ").append(row.get("vehicles"))
                        .append("대, 만석 ").append(row.get("full_cnt"))
                        .append("건, 좌석정보 없음 ").append(row.get("missing")).append("건\n");
            }
        }
        sb.append("- 위치정보 호출 ").append(quota.used("location", today))
                .append(" / ").append(quota.dailyLimit()).append("회");
        notifier.info("daily-" + today, sb.toString());
    }
}
