package kr.khu.bus.collector.collect;

import java.time.LocalDate;
import java.util.List;
import kr.khu.bus.collector.config.CollectorProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * API별 일일 호출 수를 DB에 세서 한도를 넘지 않게 한다.
 * DB에 저장하므로 컨테이너가 재시작돼도 그날 카운트가 유지된다.
 * 실패한 호출도 포털 한도에 포함되므로 호출 전에 미리 1을 올린다.
 */
@Component
public class QuotaGuard {

    private final JdbcTemplate jdbc;
    private final int dailyLimit;

    public QuotaGuard(JdbcTemplate jdbc, CollectorProperties props) {
        this.jdbc = jdbc;
        this.dailyLimit = props.dailyLimit();
    }

    /** 한도 안이면 1을 올리고 true, 한도에 도달했으면 false. */
    public boolean tryAcquire(String api, LocalDate day) {
        List<Integer> updated = jdbc.queryForList("""
                INSERT INTO api_call_count (day, api, calls) VALUES (?, ?, 1)
                ON CONFLICT (day, api) DO UPDATE SET calls = api_call_count.calls + 1
                WHERE api_call_count.calls < ?
                RETURNING calls
                """, Integer.class, day, api, dailyLimit);
        return !updated.isEmpty();
    }

    public int used(String api, LocalDate day) {
        List<Integer> r = jdbc.queryForList(
                "SELECT calls FROM api_call_count WHERE day = ? AND api = ?", Integer.class, day, api);
        return r.isEmpty() ? 0 : r.get(0);
    }

    public int dailyLimit() {
        return dailyLimit;
    }
}
