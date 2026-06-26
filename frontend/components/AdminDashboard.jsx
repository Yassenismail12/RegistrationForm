import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import * as XLSX from 'xlsx';

const SESSION_KEY = 'yly_admin_token';
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const CHART_COLORS = [
  '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04',
  '#16a34a', '#0891b2', '#4f46e5', '#be123c', '#0d9488',
];

function getStoredToken() {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(SESSION_KEY);
}

function storeToken(token) {
  sessionStorage.setItem(SESSION_KEY, token);
}

function clearToken() {
  sessionStorage.removeItem(SESSION_KEY);
}

async function adminFetch(path, token, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    const err = new Error('Unauthorized');
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'فشل تسجيل الدخول');
        return;
      }

      storeToken(data.token);
      onLogin(data.token);
    } catch {
      setError('حدث خطأ أثناء الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <h1>لوحة تحكم الإدارة</h1>
        <p>أدخل كلمة المرور للوصول إلى إحصائيات التسجيل</p>
        {error && <div className="admin-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="admin-field">
            <label htmlFor="admin-password">كلمة المرور</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="admin-btn admin-btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'جاري الدخول...' : 'دخول'}
          </button>
        </form>
      </div>
    </div>
  );
}

function buildDailyChartData(dailyRows, topGovernorates) {
  const dateMap = new Map();

  dailyRows.forEach(({ date, governorate, count }) => {
    if (!topGovernorates.includes(governorate)) return;
    if (!dateMap.has(date)) {
      dateMap.set(date, { date });
    }
    dateMap.get(date)[governorate] = count;
  });

  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
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

function AdminDashboardContent({ token, onLogout }) {
  const [stats, setStats] = useState(null);
  const [daily, setDaily] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [statsData, dailyData] = await Promise.all([
        adminFetch('/api/admin/stats', token),
        adminFetch('/api/admin/stats/daily', token),
      ]);
      setStats(statsData);
      setDaily(dailyData.daily || []);
    } catch (err) {
      if (err.code === 'UNAUTHORIZED') {
        onLogout();
        return;
      }
      setError(err.message || 'فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const maxCount = useMemo(() => {
    if (!stats?.governorates?.length) return 1;
    return Math.max(...stats.governorates.map((g) => g.count), 1);
  }, [stats]);

  const barChartData = useMemo(() => {
    if (!stats?.governorates) return [];
    return stats.governorates
      .filter((g) => g.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [stats]);

  const topGovernorates = useMemo(
    () => barChartData.slice(0, 8).map((g) => g.governorate),
    [barChartData],
  );

  const lineChartData = useMemo(
    () => buildDailyChartData(daily, topGovernorates),
    [daily, topGovernorates],
  );

  const handleExport = async () => {
    setExporting(true);
    setError('');

    try {
      const data = await adminFetch('/api/admin/export', token);
      exportToExcel(data.applicants || []);
    } catch (err) {
      if (err.code === 'UNAUTHORIZED') {
        onLogout();
        return;
      }
      setError(err.message || 'فشل تصدير البيانات');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-container">
          <div className="admin-loading">جاري تحميل البيانات...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-container">
        <div className="admin-header">
          <h1>لوحة تحكم التسجيل</h1>
          <div className="admin-actions">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={loadData}>
              تحديث
            </button>
            <button type="button" className="admin-btn admin-btn-primary" onClick={handleExport} disabled={exporting}>
              {exporting ? 'جاري التصدير...' : 'تصدير Excel'}
            </button>
            <button type="button" className="admin-btn admin-btn-danger" onClick={onLogout}>
              خروج
            </button>
          </div>
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <div className="stat-value">{stats?.total?.toLocaleString('ar-EG') ?? 0}</div>
            <div className="stat-label">إجمالي التسجيلات</div>
          </div>
        </div>

        <div className="admin-section">
          <h2>التسجيلات حسب المحافظة</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>المحافظة</th>
                  <th>عدد التسجيلات</th>
                  <th>النسبة</th>
                  <th>التقدم</th>
                </tr>
              </thead>
              <tbody>
                {(stats?.governorates || [])
                  .slice()
                  .sort((a, b) => b.count - a.count)
                  .map((row) => (
                    <tr key={row.governorate}>
                      <td>{row.governorate}</td>
                      <td className="count-cell">{row.count.toLocaleString('ar-EG')}</td>
                      <td>{row.percentage}%</td>
                      <td>
                        <div className="admin-progress-bar">
                          <div
                            className="admin-progress-bar-fill"
                            style={{ width: `${(row.count / maxCount) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="admin-section">
          <h2>رسم بياني — عدد التسجيلات لكل محافظة</h2>
          <div className="admin-chart-wrap">
            {barChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData} margin={{ top: 10, right: 10, left: 0, bottom: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="governorate"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    angle={-45}
                    textAnchor="end"
                    height={90}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value) => [value.toLocaleString('ar-EG'), 'عدد التسجيلات']}
                    labelStyle={{ direction: 'rtl' }}
                  />
                  <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} name="عدد التسجيلات" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="admin-loading">لا توجد بيانات للعرض</div>
            )}
          </div>
        </div>

        {lineChartData.length > 0 && (
          <div className="admin-section">
            <h2>تطور التسجيلات اليومي (أعلى 8 محافظات)</h2>
            <div className="admin-chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineChartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} allowDecimals={false} />
                  <Tooltip labelStyle={{ direction: 'rtl' }} />
                  <Legend />
                  {topGovernorates.map((gov, index) => (
                    <Line
                      key={gov}
                      type="monotone"
                      dataKey={gov}
                      stroke={CHART_COLORS[index % CHART_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      name={gov}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setToken(getStoredToken());
    setReady(true);
  }, []);

  const handleLogin = (newToken) => {
    setToken(newToken);
  };

  const handleLogout = () => {
    clearToken();
    setToken(null);
  };

  if (!ready) {
    return null;
  }

  if (!token) {
    return <AdminLogin onLogin={handleLogin} />;
  }

  return <AdminDashboardContent token={token} onLogout={handleLogout} />;
}
