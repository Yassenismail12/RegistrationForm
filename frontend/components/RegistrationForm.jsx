import { useState, useEffect, useRef } from 'react';

const DEFAULT_GOVERNORATES = [
  'القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'البحيرة',
  'الفيوم', 'الغربية', 'الإسماعيلية', 'المنوفية', 'المنيا',
  'القليوبية', 'الوادي الجديد', 'السويس', 'أسوان', 'أسيوط',
  'بني سويف', 'بورسعيد', 'دمياط', 'الشرقية', 'جنوب سيناء',
  'كفر الشيخ', 'مطروح', 'الأقصر', 'قنا', 'شمال سيناء', 'سوهاج', 'البحر الأحمر',
];

const DEFAULT_STUDY_YEARS = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'خريج','ثانوية عامة'];
const DEFAULT_HOW_YOU_KNOW_US = ['الأصدقاء', 'فيسبوك', 'إنستجرام', 'تيكتوك', 'تويتر', 'لينكد ان', 'الشيرنج', 'اخرى'];

const STORAGE_KEY_FORM = 'yly_registration_form_data';
const STORAGE_KEY_PAGE_DATA = 'yly_registration_page_data';

const EMPTY_FORM = {
  full_name: '',
  national_id: '',
  whatsapp: '',
  email: '',
  age: '',
  governorate: '',
  university: '',
  faculty: '',
  study_year: '',
  has_volunteer_experience: null,
  how_know_about_us: '',
  volunteer_experience: "",
  egyptian: true,
  website: '',
};

function toEnglishNumbers(str) {
  return str
    .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660)
    .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06F0);
}

function normalizeSavedForm(saved) {
  const hasExp = saved.has_volunteer_experience !== undefined
    ? saved.has_volunteer_experience
    : saved.volunteeredBefore !== undefined
      ? saved.volunteeredBefore
      : null;

  return {
    ...EMPTY_FORM,
    ...saved,
    full_name: saved.full_name ?? saved.fullNameAr ?? '',
    age: saved.age ?? '',
    national_id: saved.national_id ?? saved.nationalId ?? '',
    study_year: saved.study_year ?? saved.studyYear ?? '',
    how_know_about_us: saved.how_know_about_us ?? saved.howKnowAboutUs ?? '',
    egyptian: typeof saved.egyptian === 'boolean' ? saved.egyptian : !saved.isNonEgyptian,
    has_volunteer_experience: typeof hasExp === 'boolean' ? hasExp : null,
  };
}

export default function RegistrationForm() {
  const [pageData, setPageData] = useState({
    governorates: DEFAULT_GOVERNORATES,
    studyYears: DEFAULT_STUDY_YEARS,
    howKnowAboutUs: DEFAULT_HOW_YOU_KNOW_US,
  });
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState(false);
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);

  useEffect(() => {
    
    const savedFormData = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY_FORM) : null;
    const savedPageData = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY_PAGE_DATA) : null;

    if (savedFormData) {
      try {
        setFormData(normalizeSavedForm(JSON.parse(savedFormData)));
      } catch (error) {
        console.warn('Failed to parse saved form data', error);
      }
    }

    if (savedPageData) {
      try {
        setPageData(JSON.parse(savedPageData));
      } catch (error) {
        console.warn('Failed to parse saved page data', error);
      }
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${apiBase}/api/page-data`, { method: 'GET' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setPageData(data);
          window.localStorage.setItem(STORAGE_KEY_PAGE_DATA, JSON.stringify(data));
        }
      })
      .catch((err) => console.warn('Unable to load page metadata', err));
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY_FORM, JSON.stringify(formData));
    }
  }, [formData]);

  useEffect(() => {
    const tryRender = () => {
      if (!turnstileRef.current || typeof window.turnstile === 'undefined') return;

      if (turnstileWidgetId.current !== null) {
        try { window.turnstile.remove(turnstileWidgetId.current); } catch {}
        turnstileWidgetId.current = null;
      }

      turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: '0x4AAAAAADmvj_jJpoBXAe62',
        theme: 'light',
        language: 'ar',
        'refresh-expired': 'auto',
        retry: 'auto',
        'retry-interval': 3000,
        callback: (token) => {
          setTurnstileToken(token);
          setTurnstileError(false);
        },
        'expired-callback': () => setTurnstileToken(''),
        'error-callback': () => setTurnstileToken(''),
      });
    };

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (typeof window.turnstile !== 'undefined') {
        clearInterval(interval);
        tryRender();
      } else if (attempts > 50) {
        clearInterval(interval);
      }
    }, 100);

    return () => {
      clearInterval(interval);
      if (turnstileWidgetId.current !== null && typeof window.turnstile !== 'undefined') {
        try { window.turnstile.remove(turnstileWidgetId.current); } catch {}
        turnstileWidgetId.current = null;
      }
    };
  }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const numericFields = ['whatsapp', 'national_id','age'];
    let nextValue = type === 'checkbox'
      ? checked
      : numericFields.includes(name) ? toEnglishNumbers(value) : value;

// Fields that should contain numbers only 
  if (['age', 'national_id', 'whatsapp'].includes(name)) {
     nextValue = toEnglishNumbers(value).replace(/\D/g, ''); 
    }
    setFormData(prev => ({ ...prev, [name]: nextValue }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const validateForm = () => {
    const newErrors = {};
    const nameParts = formData.full_name.trim().split(/\s+/);

    if (!formData.full_name.trim()) {
      newErrors.full_name = 'الاسم الرباعي مطلوب';
    } else if (nameParts.length < 4) {
      newErrors.full_name = 'يجب إدخال الاسم رباعياً على الأقل';
    } else if (!/^[\u0600-\u06FF\s]+$/.test(formData.full_name.trim())) {
      newErrors.full_name = 'الاسم يجب أن يكون بالعربية فقط';
    }
if (!formData.age.trim()) {
  newErrors.age = 'السن مطلوب';
} else if (!/^[0-9]+$/.test(formData.age.trim())) {
  newErrors.age = 'السن يجب أن يكون أرقامًا فقط';
} else if (Number(formData.age) < 10 || Number(formData.age) > 100) {
  newErrors.age = 'يرجى إدخال سن صحيح';
}
    if (!formData.national_id.trim()) {
      newErrors.national_id = formData.egyptian ? 'الرقم القومي مطلوب' : 'رقم الباسبور مطلوب';
    } else if (formData.egyptian && !/^[23][0-9]{13}$/.test(formData.national_id)) {
      newErrors.national_id = 'الرقم القومي يجب أن يكون 14 رقمًا ويبدأ بـ 2 أو 3';
    }
// Add after the governorate field-group in validateForm:
if (!formData.governorate) newErrors.governorate = 'المحافظة مطلوبة';
    if (!formData.whatsapp.trim()) newErrors.whatsapp = 'رقم الواتساب مطلوب';
    if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'صيغة الايميل غير صحيحة';
    }
    if (!formData.how_know_about_us) newErrors.how_know_about_us = 'هذا الحقل مطلوب';
if (formData.has_volunteer_experience === null) {
  newErrors.has_volunteer_experience = 'هذا الحقل مطلوب';
}
    if (
  formData.has_volunteer_experience &&
  !formData.volunteer_experience.trim()
) {
  newErrors.volunteer_experience =
    'يرجى شرح خبرتك التطوعية';
}
    setErrors(newErrors);
    const firstErrorKey = Object.keys(newErrors)[0];
    if (firstErrorKey) {
      const el = document.querySelector(`[name="${firstErrorKey}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      }
    }
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    if (!turnstileToken) {
      setTurnstileError(true);
      return;
    }

setSubmitting(true);
setSubmitError('');

const controller = new AbortController();

const timeout = setTimeout(() => {
  controller.abort();
}, 15000);

try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL;
      const res = await fetch(`${apiBase}/api/register`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    ...formData,
    turnstileToken,
  }),
  signal: controller.signal,
});

clearTimeout(timeout);

      if (!res.ok) {
let data = null;
try { data = await res.json(); } catch { data = {}; }
const message = data?.error || 'network';  // ✅

        if (res.status === 409 || message === 'هذا الرقم القومي مسجل بالفعل') {
  setErrors(prev => ({ ...prev, national_id: message }));
  const el = document.querySelector('[name="national_id"]');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
  }
  if (turnstileWidgetId.current !== null && window.turnstile) {
    window.turnstile.reset(turnstileWidgetId.current);
  }
  setTurnstileToken('');
  setSubmitting(false);
  return; 
}

        throw new Error(message);
      }

      const data = await res.json();
      console.log('تم الإرسال بنجاح، رقم التسجيل:', data.id);
      setSubmitted(true);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY_FORM);
      }
    } catch (err) {
  console.error(err);

  if (turnstileWidgetId.current !== null && window.turnstile) {
    window.turnstile.reset(turnstileWidgetId.current);
  }
  setTurnstileToken('');

  if (err.name === 'AbortError') {
    setSubmitError(
      'انتهت مهلة الاتصال بالخادم. برجاء المحاولة مرة أخرى.'
    );
  } else {
    setSubmitError(
      'حدث خطأ أثناء إرسال البيانات. يرجى المحاولة مرة أخرى.'
    );
  }
} finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="page-wrapper">
        <div className="form-container">
          <div className="success-page">
            <div className="success-icon">✓</div>
            <h2>شكراً لتسجيلك</h2>
            <p>تابعنا من خلال المنصات: </p>
            <div className="social-links">
              <a href="https://www.instagram.com/ylyministry" target="_blank" rel="noreferrer" className="social-link">
                <img src="https://img.icons8.com/fluency/48/000000/instagram-new.png" alt="Instagram" className="social-icon" />
              </a>
              <a href="https://www.tiktok.com/@ylyministry?_r=1&_t=ZS-97EG3HU4pOO" target="_blank" rel="noreferrer" className="social-link">
                <img src="https://img.icons8.com/fluency/48/000000/tiktok.png" alt="TikTok" className="social-icon" />
              </a>
              <a href="https://www.facebook.com/Ylyministryy/" target="_blank" rel="noreferrer" className="social-link">
                <img src="https://img.icons8.com/fluency/48/000000/facebook-new.png" alt="Facebook" className="social-icon" />
              </a>
              <a href="https://eg.linkedin.com/company/ylyministry" target="_blank" rel="noreferrer" className="social-link">
                <img src="https://img.icons8.com/fluency/48/000000/linkedin-circled.png" alt="LinkedIn" className="social-icon" />
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <div className="form-container">
        <div className="form-header">
          <img src="/assets/YLY-logo.png" alt="Leading Youth" className="leading-logo-img" />
          <div className="form-title">
            <img src="/assets/Wzara.png" alt="وزارة الشباب والرياضة" className="title-img-sub" />
            <img src="/assets/ITIHAD.png" alt="اتحاد شباب يدير شباب" className="title-img-main" />
            <h2>YLY</h2>
          </div>
          <img src="/assets/Ministry.png" alt="وزارة الشباب والرياضة" className="ministry-logo-img" />
        </div>

        <div className="form-body">
          <div className="welcome-section">
            <h2>أهلاً بك في الموسم الثامن</h2>
            <h3>٢٠٢٦ - ٢٠٢٧</h3>
          </div>

          <div className="step-content">
            <h3 className="step-title">البيانات الشخصية</h3>
            <div className="fields-grid">
              <div className="column">
                <div className="field-group">
                  <label>١- الاسم العربي رباعي</label>
                  <input name="full_name" value={formData.full_name} onChange={handleChange} placeholder="الاسم العربي رباعي" />
                  {errors.full_name && <span className="error">{errors.full_name}</span>}
                </div>
                
<div className="field-group">
  <label>٣- السن</label>
<input
  type="number"
  name="age"
  value={formData.age}
  onChange={handleChange}
  placeholder="السن"
  min="10"
  max="100"
  step="1"
  inputMode="numeric"
  onKeyDown={(e) => {
    if (
      ['e', 'E', '+', '-', '.'].includes(e.key)
    ) {
      e.preventDefault();
    }
  }}
/>
  {errors.age && <span className="error">{errors.age}</span>}
</div>
                <div className="field-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ margin: 0 }}>٥- {formData.egyptian ? 'الرقم القومي' : 'رقم الباسبور'}</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal', fontSize: '12px', color: '#1034A8' }}>
                      <span id="not-egyptian">مصري؟</span>
                      <span style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px' }}>
                        <input
                          type="checkbox"
                          name="egyptian"
                          checked={formData.egyptian}
                          onChange={handleChange}
                          style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                        />
                        <span style={{
                          position: 'absolute',
                          inset: 0,
                          background: formData.egyptian ? '#1034A8' : '#797979',
                          borderRadius: '999px',
                          transition: 'background 0.2s ease',
                        }}>
                          <span style={{
                            position: 'absolute',
                            top: '2px',
                            [formData.egyptian ? 'right' : 'left']: '2px',
                            width: '16px',
                            height: '16px',
                            background: '#fff',
                            borderRadius: '50%',
                            transition: 'left 0.2s ease, right 0.2s ease',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                          }} />
                        </span>
                      </span>
                    </label>
                  </div>
                  <input
                    name="national_id"
                    value={formData.national_id}
                    onChange={handleChange}
                    placeholder={formData.egyptian ? 'مكوّن من 14 رقم' : 'رقم الباسبور'}
                    maxLength={formData.egyptian ? 14 : 100}
                  />
                  {errors.national_id && <span className="error">{errors.national_id}</span>}
                </div>
              </div>

              <div className="divider" />

              <div className="column">
                <div className="field-group">
                  <label>٢- رقم الواتساب</label>
                  <input name="whatsapp" type="text" inputMode="numeric" value={formData.whatsapp} onChange={handleChange} placeholder="رقم الواتساب" />
                  {errors.whatsapp && <span className="error">{errors.whatsapp}</span>}
                </div>
                <div className="field-group">
                  <label>٤- الايميل (اختياري)</label>
                  <input name="email" type="email" value={formData.email} onChange={handleChange} placeholder="الايميل" />
                  {errors.email && <span className="error">{errors.email}</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="step-content">
            <h3 className="step-title">البيانات الأكاديمية</h3>
            <div className="fields-grid">
              <div className="column">
                <div className="field-group">
                  <label>٦- المحافظة</label>
                  <select name="governorate" value={formData.governorate} onChange={handleChange}>
                    <option value="">اختر المحافظة</option>
                    {pageData.governorates.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  {errors.governorate && <span className="error">{errors.governorate}</span>}
                </div>
                <div className="field-group">
                  <label>٨- الجامعة</label>
                  <input name="university" value={formData.university} onChange={handleChange} placeholder="الجامعة" />
                  {errors.university && <span className="error">{errors.university}</span>}
                </div>
              </div>

              <div className="divider" />

              <div className="column">
                <div className="field-group">
                  <label>٧- الكلية</label>
                  <input name="faculty" value={formData.faculty} onChange={handleChange} placeholder="الكلية" />
                  {errors.faculty && <span className="error">{errors.faculty}</span>}
                </div>
                <div className="field-group">
                  <label>٩- الفرقة</label>
                  <select name="study_year" value={formData.study_year} onChange={handleChange}>
                    <option value="">اختر الفرقة</option>
                    {pageData.studyYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  {errors.study_year && <span className="error">{errors.study_year}</span>}
                </div>
              </div>
            </div>
          </div>
                            
          <div className="step-content">
            <h3 className="step-title">المصدر</h3>
            <div className="fields-grid" style={{ flexDirection: 'column' }}>
              <div className="column" style={{ width: '100%' }}>
              <div className="field-group">
  <label>١٠- هل تطوعت في حاجة قبل كده؟</label>

  <select
    name="has_volunteer_experience"
    value={formData.has_volunteer_experience === null ? '' : formData.has_volunteer_experience ? 'yes' : 'no'}
    onChange={(e) => {
      const raw = e.target.value;
      const value = raw === '' ? null : raw === 'yes';

      setFormData(prev => ({
        ...prev,
        has_volunteer_experience: value,
        volunteer_experience: value
          ? prev.volunteer_experience
          : '',
      }));

      if (errors.has_volunteer_experience) {
        setErrors(prev => ({
          ...prev,
          has_volunteer_experience: '',
        }));
      }
    }}
  >
    <option value="">اختر</option>
    <option value="yes">نعم</option>
    <option value="no">لا</option>
  </select>

  {errors.has_volunteer_experience && (
    <span className="error">
      {errors.has_volunteer_experience}
    </span>
  )}
</div>

{formData.has_volunteer_experience && (
  <div className="field-group">
    <label>ما الذي تطوعت فيه؟</label>

    <textarea
      name="volunteer_experience"
      value={formData.volunteer_experience}
      onChange={handleChange}
      placeholder="اشرح الخبرة التطوعية السابقة"
      style={{
        border: 'none',
        borderBottom: '2px solid #e0b842',
        background: 'transparent',
        padding: '6px 4px',
        fontFamily: "'Beiruti', sans-serif",
        fontSize: '13px',
        color: '#555',
        textAlign: 'right',
        outline: 'none',
        minHeight: '80px',
        resize: 'vertical'
      }}
    />

    {errors.volunteer_experience && (
      <span className="error">
        {errors.volunteer_experience}
      </span>
    )}
  </div>
)}
                <div className="field-group">
                  <label>١١- عرفت عننا منين؟</label>
                  <select name="how_know_about_us" value={formData.how_know_about_us} onChange={handleChange}>
                    <option value="">اختر المصدر</option>
                    {pageData.howKnowAboutUs.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                  {errors.how_know_about_us && <span className="error">{errors.how_know_about_us}</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="step-content">
            <h3 className="step-title">التحقق وإرسال النموذج</h3>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
              <div ref={turnstileRef} />
            </div>
            {turnstileError && !turnstileToken && (
              <p style={{ color: 'red', textAlign: 'center', fontSize: '13px' }}>
                يرجى إتمام التحقق أولاً
              </p>
            )}
            {submitError && (
              <p style={{ color: 'red', textAlign: 'center', fontSize: '13px' }}>
                {submitError}
              </p>
            )}
            <button className="btn-submit" onClick={handleSubmit} disabled={submitting || submitted}>
              {submitting ? 'جاري الإرسال...' : 'إرسال البيانات'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
