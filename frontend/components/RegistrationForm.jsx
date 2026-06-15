import { useState, useEffect, useRef } from 'react';

const DEFAULT_GOVERNORATES = [
  'القاهرة','الجيزة','الإسكندرية','الدقهلية','البحيرة',
  'الفيوم','الغربية','الإسماعيلية','المنوفية','المنيا',
  'القليوبية','الوادي الجديد','السويس','أسوان','أسيوط',
  'بني سويف','بورسعيد','دمياط','الشرقية','جنوب سيناء',
  'كفر الشيخ','مطروح','الأقصر','قنا','شمال سيناء','سوهاج','البحر الأحمر',
];

const DEFAULT_STUDY_YEARS = ['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','خريج'];

const DEFAULT_HOW_YOU_KNOW_US = ['الأصدقاء', 'فيسبوك', 'إنستجرام', 'تيكتوك', 'تويتر', 'لينكد ان', 'الاشلرينج', 'اخرى'];

const STORAGE_KEY_FORM = 'yly_registration_form_data';
const STORAGE_KEY_PAGE_DATA = 'yly_registration_page_data';

export default function RegistrationForm() {
  const [pageData, setPageData] = useState({
    governorates: DEFAULT_GOVERNORATES,
    studyYears: DEFAULT_STUDY_YEARS,
    howKnowAboutUs: DEFAULT_HOW_YOU_KNOW_US,
  });
  const [formData, setFormData] = useState({
    fullNameAr: '', nationalId: '', whatsapp: '', email: '',
    governorate: '', university: '', faculty: '', studyYear: '',
    volunteeredBefore: '', volunteerDetails: '', howKnowAboutUs: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState(false);
  const turnstileRef = useRef(null);

  useEffect(() => {
    const savedFormData = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY_FORM) : null;
    const savedPageData = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY_PAGE_DATA) : null;

    if (savedFormData) {
      try {
        setFormData(JSON.parse(savedFormData));
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

    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8787';
    fetch(`${apiBase}/api/page-data`, { method: 'GET' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setPageData(data);
          window.localStorage.setItem(STORAGE_KEY_PAGE_DATA, JSON.stringify(data));
        }
      })
      .catch((err) => console.warn('Unable to load page metadata', err));

    let widgetId = null;

    const tryRender = () => {
      if (!turnstileRef.current) return;
      if (typeof window.turnstile === 'undefined') return;

      if (widgetId !== null) {
        try { window.turnstile.remove(widgetId); } catch {}
      }

      widgetId = window.turnstile.render(turnstileRef.current, {
        sitekey: '0x4AAAAAADkzJ8tcT5glStf5',
        theme: 'light',
        language: 'ar',
        callback: (token) => {
          setTurnstileToken(token);
          setTurnstileError(false);
        },
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
      if (widgetId !== null && typeof window.turnstile !== 'undefined') {
        try { window.turnstile.remove(widgetId); } catch {}
      }
    };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY_FORM, JSON.stringify(next));
      }
      return next;
    });
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.fullNameAr.trim()) newErrors.fullNameAr = 'الاسم العربي رباعي مطلوب';
    if (!/^[0-9]{14}$/.test(formData.nationalId)) newErrors.nationalId = 'الرقم القومي يجب أن يكون 14 رقمًا';
    if (!/^[0-9]{10,11}$/.test(formData.whatsapp)) newErrors.whatsapp = 'رقم واتساب غير صحيح';
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'الايميل غير صحيح';

    if (!formData.governorate) newErrors.governorate = 'اختر المحافظة';
    if (!formData.university.trim()) newErrors.university = 'الجامعة مطلوبة';
    if (!formData.faculty.trim()) newErrors.faculty = 'الكلية مطلوبة';
    if (!formData.studyYear) newErrors.studyYear = 'اختر الفرقة';

    if (!formData.volunteeredBefore) newErrors.volunteeredBefore = 'هل تطوعت من قبل مطلوب';
    if (formData.volunteeredBefore === 'yes' && !formData.volunteerDetails.trim()) {
      newErrors.volunteerDetails = 'اشرح ماذا تطوعت فيه';
    }
    if (!formData.howKnowAboutUs) newErrors.howKnowAboutUs = 'كيف عرفت عننا مطلوب';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

 const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }
    if (!turnstileToken) {
      setTurnstileError(true);
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8787';
      const res = await fetch(`${apiBase}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, turnstileToken }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || 'network');
      }
      
      const data = await res.json();
      console.log("تم الإرسال بنجاح، رقم المستند:", data.id);
      
      
      setSubmitted(true);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY_FORM);
      }
    } catch (err) {
      console.error(err);
      setSubmitError('فشل إرسال البيانات. تأكد إن السيرفر (Backend) شغال أولاً.');
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
            <p>يمكنك متابعه الموقع الرسمي الخاص بنا</p>
            <button className="btn-submit" onClick={() => window.location.href = '/'}>العودة للرئيسية</button>
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
            <img src="/assets/ITIHAD.png" alt=" اتحاد شباب يدير شباب" className="title-img-main" />
          </div>
          <img src="/assets/Ministry.png" alt="وزارة الشباب والرياضة" className="ministry-logo-img" />
        </div>

        <div className="form-body">
          <div className="welcome-section">
            <h2>أهلاً بك في الموسم الثامن</h2>
          </div>

          <div className="step-content">
            <h3 className="step-title">البيانات الشخصية</h3>
            <div className="fields-grid">
              <div className="column">
                <div className="field-group">
                  <label>١ـ الاسم العربي رباعي</label>
                  <input name="fullNameAr" value={formData.fullNameAr} onChange={handleChange} placeholder="الاسم العربي رباعي" />
                  {errors.fullNameAr && <span className="error">{errors.fullNameAr}</span>}
                </div>
                <div className="field-group">
                  <label>٣ـ الرقم القومي</label>
                  <input name="nationalId" value={formData.nationalId} onChange={handleChange} placeholder="مكوّن من 14 رقم" maxLength={14} />
                  {errors.nationalId && <span className="error">{errors.nationalId}</span>}
                </div>
              </div>
              <div className="divider" />
              <div className="column">
                <div className="field-group">
                  <label>٢ـ رقم الواتساب</label>
                  <input name="whatsapp" value={formData.whatsapp} onChange={handleChange} placeholder="رقم الواتساب" />
                  {errors.whatsapp && <span className="error">{errors.whatsapp}</span>}
                </div>
                <div className="field-group">
                  <label>٤ـ الايميل</label>
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
                  <label>٥ـ المحافظة</label>
                  <select name="governorate" value={formData.governorate} onChange={handleChange}>
                    <option value="">اختر المحافظة</option>
                    {pageData.governorates.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  {errors.governorate && <span className="error">{errors.governorate}</span>}
                </div>
                <div className="field-group">
                  <label>٧ـ الجامعة</label>
                  <input name="university" value={formData.university} onChange={handleChange} placeholder="الجامعة" />
                  {errors.university && <span className="error">{errors.university}</span>}
                </div>
              </div>
              <div className="divider" />
              <div className="column">
                <div className="field-group">
                  <label>٦ـ الكلية</label>
                  <input name="faculty" value={formData.faculty} onChange={handleChange} placeholder="الكلية" />
                  {errors.faculty && <span className="error">{errors.faculty}</span>}
                </div>
                <div className="field-group">
                  <label>٨ـ الفرقة</label>
                  <select name="studyYear" value={formData.studyYear} onChange={handleChange}>
                    <option value="">اختر الفرقة</option>
                    {pageData.studyYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  {errors.studyYear && <span className="error">{errors.studyYear}</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="step-content">
            <h3 className="step-title">الخبرة والمصدر</h3>
            <div className="fields-grid" style={{flexDirection: 'column'}}>
              <div className="column" style={{width: '100%'}}>
                <div className="field-group">
                  <label>٩ـ هل تطوعت في حاجة قبل كده؟</label>
                  <select name="volunteeredBefore" value={formData.volunteeredBefore} onChange={handleChange}>
                    <option value="">اختر</option>
                    <option value="yes">نعم</option>
                    <option value="no">لا</option>
                  </select>
                  {errors.volunteeredBefore && <span className="error">{errors.volunteeredBefore}</span>}
                </div>
                {formData.volunteeredBefore === 'yes' && (
                  <div className="field-group">
                    <label>ما الذي تطوعت فيه؟</label>
                    <textarea name="volunteerDetails" value={formData.volunteerDetails} onChange={handleChange} placeholder="اشرح الخبرة التطوعية السابقة" style={{border: 'none', borderBottom: '2px solid #e0b842', background: 'transparent', padding: '6px 4px', fontFamily: "'Beiruti', sans-serif", fontSize: '13px', color: '#555', textAlign: 'right', outline: 'none', minHeight: '80px', resize: 'vertical'}} />
                    {errors.volunteerDetails && <span className="error">{errors.volunteerDetails}</span>}
                  </div>
                )}
                <div className="field-group" style={{marginTop: '20px'}}>
                  <label>١٠ـ عرفت عننا منين؟</label>
                  <select name="howKnowAboutUs" value={formData.howKnowAboutUs} onChange={handleChange}>
                    <option value="">اختر المصدر</option>
                    {pageData.howKnowAboutUs.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                  {errors.howKnowAboutUs && <span className="error">{errors.howKnowAboutUs}</span>}
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
