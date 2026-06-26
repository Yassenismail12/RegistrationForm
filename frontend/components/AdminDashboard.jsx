import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import * as XLSX from 'xlsx';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function formatArabicTime(date) {
  return date.toLocaleTimeString('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Africa/Cairo',
  });
}

function formatHourLabel(hour) {
  const period = hour >= 12 ? 'م' : 'ص';
  const displayHour = hour % 12 || 12;
  return `${displayHour} ${period}`;
}

function formatHourTooltip(hour) {
  const period = hour >= 12 ? 'م' : 'ص';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${period}`;
}

async function dashboardFetch(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function exportToExcel(applicants) {
  const rows = applicants.map((row) => ({
    'رقم': row.id,
    'الاسم': row.full_name,
    'الرقم القومي': row.national_id,
    'واتساب': row.whatsapp,
    'البريد الإلكتروني': row.email || '',
    'العمر': row.age ?? '',
    'المحافظة': row.governorate || '',
    'الجامعة': row.university || '',
    'الكلية': row.faculty || '',
    'السنة الدراسية': row.study_year || '',
    'كيف عرفت عنا': row.how_know_about_us || '',
    'خبرة تطوعية': row.has_volunteer_experience ? 'نعم' : 'لا',
    'تفاصيل التطوع': row.volunteer_experience || '',
    'مصري': row.egyptian ? 'نعم' : 'لا',
    'تاريخ التسجيل': row.submitted_at || '',
    'المصدر': row.source || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'التسجيلات');

  const summaryRows = applicants.reduce((acc, row) => {
    const gov = row.governorate || 'غير محدد';
    acc[gov] = (acc[gov] || 0) + 1;
    return acc;
  }, {});

  const summarySheet = XLSX.utils.json_to_sheet(
    Object.entries(summaryRows)
      .map(([governorate, count]) => ({ المحافظة: governorate, العدد: count }))
      .sort((a, b) => b.العدد - a.العدد),
  );
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'ملخص المحافظات');

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `yly-registrations-${date}.xlsx`);
}

function HourlyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { hour, count } = payload[0].payload;
  return (
    <div className="dash-tooltip">
      <div className="dash-tooltip-time">الساعة {formatHourTooltip(hour)}</div>
      <div className="dash-tooltip-count">{count.toLocaleString('ar-EG')} متطوع</div>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [hourly, setHourly] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async (isBackground = false) => {
    if (isBackground) {
      setRefreshing(true);
    }
    setError('');

    try {
      const [statsData, hourlyData] = await Promise.all([
        dashboardFetch('/api/dashboard/stats'),
        dashboardFetch('/api/dashboard/hourly'),
      ]);
      setStats(statsData);
      setHourly(hourlyData.hourly || []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || 'فشل تحميل البيانات');
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(false);
    const interval = setInterval(() => loadData(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadData]);

  const sortedGovernorates = useMemo(() => {
    if (!stats?.governorates) return [];
    return stats.governorates
      .slice()
      .sort((a, b) => b.count - a.count);
  }, [stats]);

  const hourlyChartData = useMemo(
    () => hourly.map((row) => ({
      ...row,
      label: formatHourLabel(row.hour),
    })),
    [hourly],
  );

  const handleExport = async () => {
    setExporting(true);
    setError('');

    try {
      const data = await dashboardFetch('/api/dashboard/export');
      exportToExcel(data.applicants || []);
    } catch (err) {
      setError(err.message || 'فشل تصدير البيانات');
    } finally {
      setExporting(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="dash-page">
        <div className="dash-loading">جاري تحميل البيانات...</div>
      </div>
    );
  }

  return (
    <div className="dash-page">
      <div className="dash-content">
        <div className="dash-total-card">
          <div className="dash-total-label">إجمالي المسجلين حتى الآن</div>
          <div className="dash-total-value">
            {(stats?.total ?? 0).toLocaleString('en-US')}
          </div>
        </div>

        <div className="dash-card">
          <h2 className="dash-card-title">التسجيلات حسب المحافظة 📍</h2>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>م</th>
                  <th>المحافظة</th>
                  <th>العدد</th>
                </tr>
              </thead>
              <tbody>
                {sortedGovernorates.map((row, index) => (
                  <tr key={row.governorate}>
                    <td className="dash-index-cell">{index + 1}</td>
                    <td>{row.governorate}</td>
                    <td className="dash-count-cell">{row.count.toLocaleString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dash-card">
          <h2 className="dash-card-title">التوزيع حسب آخر 24 ساعة ⏱️</h2>
          <div className="dash-chart-wrap">
            {hourlyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hourlyChartData} margin={{ top: 8, right: 4, left: 0, bottom: 4 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    interval={2}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide allowDecimals={false} />
                  <Tooltip content={<HourlyTooltip />} cursor={{ fill: 'rgba(37, 99, 235, 0.08)' }} />
                  <Bar dataKey="count" fill="#2563eb" radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="dash-loading">لا توجد بيانات للعرض</div>
            )}
          </div>
        </div>

        {error && <div className="dash-error">{error}</div>}

        <div className="dash-export-wrap">
          <button
            type="button"
            className="dash-export-btn"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'جاري التصدير...' : '⬇️ تصدير Excel'}
          </button>
        </div>

        <div className="dash-footer">
          {lastUpdated && (
            <p className="dash-footer-time">
              آخر تحديث: {formatArabicTime(lastUpdated)}
              {refreshing ? ' (جاري التحديث...)' : ''}
            </p>
          )}
          <p className="dash-footer-note">الصفحة تُحدث نفسها تلقائياً كل 5 دقائق</p>
        </div>
      </div>
    </div>
  );
}
