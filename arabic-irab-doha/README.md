# إعراب الكلمات العربية

واجهة تعليمية لتحليل كلمة عربية في سياقها أو إعراب الجمل كاملة. الواجهة على GitHub Pages، وخدمة التحليل على Cloudflare Workers AI.

## التشغيل المجاني

يعتمد Worker على Workers AI binding باسم AI ويستخدم النموذج السريع @cf/meta/llama-3.1-8b-instruct-fast مع إخراج JSON منظم. لا يحتاج إلى OPENAI_API_KEY أو رصيد OpenAI. حصة Cloudflare Workers AI المجانية محدودة يوميًا؛ عند بلوغ الحد على Workers Free تتوقف الطلبات إلى إعادة الضبط ولا يتم فرض رسوم تلقائيًا. راجع لوحة Workers AI للاستهلاك، وتأكد من البقاء على Workers Free.

## الملفات

- index.html: واجهة عربية RTL ومخرجات منظمة.
- worker.js: خدمة التحليل، التحقق من المدخلات، JSON Schema، CORS، وحد مؤقت للطلبات لكل عنوان IP داخل عزل Worker.
- wrangler.toml: إعداد النشر وربط AI.

## إعداد Cloudflare Dashboard

1. افتح Worker arabic-irab-doha-api ثم Settings.
2. ضمن Bindings اختر Add binding، ثم Workers AI.
3. اجعل اسم المتغير AI، وحدد Production، ثم احفظ وانشر.
4. افتح Edit code والصق worker.js ثم اضغط Deploy.

لا تضف OPENAI_API_KEY. لا توجد أي مفاتيح API مطلوبة لهذا المسار.

## ملاحظة الحصة

خطة Workers Free تتضمن حصة Workers AI يومية محدودة. عند استنفادها، أعد التجربة بعد وقت إعادة الضبط؛ لا تنتقل إلى Workers Paid إذا أردت إبقاء الاستخدام بلا تكلفة.
