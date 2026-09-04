export const t = {
  appName: 'نظام نقاط البيع',
  appTagline: 'إدارة المخزون والمبيعات والمواقع',

  // nav
  dashboard: 'لوحة التحكم',
  pos: 'نقطة البيع',
  items: 'المخزون / القطع',
  pricing: 'التسعير اليومي',
  locations: 'الفروع والمواقع',
  transfers: 'النقل بين الفروع',
  stockCounts: 'الجرد',
  invoices: 'الفواتير',
  reservations: 'الحجوزات والعربون',
  shifts: 'الشيفتات والتسوية',
  reports: 'التقارير',
  employees: 'الموظفين',

  // common
  save: 'حفظ',
  cancel: 'إلغاء',
  search: 'بحث',
  add: 'إضافة',
  edit: 'تعديل',
  delete: 'حذف',
  actions: 'إجراءات',
  total: 'الإجمالي',
  date: 'التاريخ',
  status: 'الحالة',
  code: 'الكود',
  name: 'الاسم',
  weight: 'الوزن (جم)',
  metalType: 'نوع المعدن',
  carat: 'العيار',
  pricePerGram: 'سعر الجرام',
  location: 'الفرع',
  employee: 'الموظف',
  notes: 'ملاحظات',
  reason: 'السبب',
  amount: 'المبلغ',
  confirm: 'تأكيد',
  back: 'رجوع',
  all: 'الكل',

  // login
  login: 'تسجيل الدخول',
  loginIdentifier: 'اسم المستخدم أو رقم الموبايل أو رقم الموظف',
  loginPin: 'كود الدخول (PIN)',
  loginError: 'بيانات الدخول غير صحيحة',

  // items
  addItem: 'إضافة قطعة',
  editItem: 'تعديل قطعة',
  itemCode: 'كود القطعة',
  barcode: 'الباركود',
  category: 'الفئة',
  size: 'المقاس / الحجم',
  stoneWeight: 'وزن الأحجار (جم)',
  craftType: 'نوع المصنعية',
  craftFixed: 'ثابتة',
  craftPercent: 'نسبة %',
  craftValue: 'قيمة المصنعية',
  cost: 'التكلفة',
  metalPriceAtAdd: 'سعر المعدن عند الإضافة',
  source: 'المصدر / الورشة',
  physicalStatus: 'الحالة الفيزيائية',
  manufacturingVariance: 'فرق وزن التصنيع',
  photo: 'الصورة',
  auditTrail: 'سجل القطعة',
  noPriceToday: 'لا يوجد سعر محدد لليوم لهذا المعدن/العيار — لا يمكن البيع',

  // pricing
  setPrice: 'تحديد سعر اليوم',
  todayPrices: 'أسعار اليوم',
  priceHistory: 'سجل الأسعار',
  effectiveDate: 'تاريخ السريان',

  // transfers
  newTransfer: 'نقل قطعة',
  transferTo: 'إلى الفرع',
  receive: 'استلام',
  inTransit: 'تحت النقل',

  // stock counts
  newCount: 'بدء جرد',
  expectedList: 'القائمة المتوقعة',
  found: 'موجودة',
  missing: 'مفقودة',
  unexpected: 'زيادة غير متوقعة',
  completeCount: 'إنهاء الجرد',
  discrepancyReport: 'تقرير الفروقات',

  // pos
  scanOrSearch: 'بحث بالكود أو الباركود',
  addToCart: 'إضافة للفاتورة',
  cart: 'الفاتورة',
  discountPercent: 'نسبة الخصم على المصنعية %',
  managerPin: 'PIN المدير للموافقة',
  checkout: 'إتمام البيع',
  printInvoice: 'طباعة الفاتورة',
  emptyCart: 'الفاتورة فارغة',
  noActivePrice: 'لا يوجد سعر لليوم لهذا المعدن',
  invoiceNo: 'رقم الفاتورة',
  cashier: 'الكاشير',
  paymentMethod: 'طريقة الدفع',
  cash: 'نقدي',
  metalValue: 'قيمة المعدن',
  craftsmanship: 'المصنعية',
  discount: 'الخصم',
  paidAmount: 'المبلغ المدفوع',

  // reservations
  newReservation: 'حجز جديد',
  customerName: 'اسم العميل',
  customerPhone: 'رقم موبايل العميل',
  downPayment: 'العربون',
  totalValue: 'القيمة الكاملة',
  remainingDue: 'المتبقي',

  // shifts
  openShift: 'فتح شيفت',
  closeShift: 'إقفال الشيفت',
  countedCash: 'الكاش الفعلي في الدرج',
  expectedCash: 'المتوقع في النظام',
  difference: 'الفرق',

  // reports
  inventoryValue: 'قيمة المخزون',
  profitability: 'الربحية',
  slowStock: 'المخزون الراكد',
  stockLimits: 'حدود المخزون',
  discrepancies: 'فروقات الجرد',
  shiftReconciliation: 'تسوية الشيفتات',

  // employees
  addEmployee: 'إضافة موظف',
  role: 'الدور',
  discountCap: 'سقف خصم المصنعية %',
  hireDate: 'تاريخ التعيين',
  resetPin: 'إعادة تعيين الكود',

  // errors
  errNoPriceToday: 'prices.missing_today',
  errNotAvailable: 'items.not_available',
};

export type TKey = keyof typeof t;
