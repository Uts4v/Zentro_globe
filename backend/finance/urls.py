"""finance/urls.py — mounted at /api/finance/"""

from django.urls import path

from . import views

urlpatterns = [
    path("summary/", views.summary, name="finance-summary"),
    path("cash/", views.cash_book, name="finance-cash"),
    path("bank/", views.bank_book, name="finance-bank"),
    path("online/", views.online_payments, name="finance-online"),
    path("settings/", views.finance_settings, name="finance-settings"),
    path("entries/", views.entries, name="finance-entries"),
    path("entries/<int:pk>/void/", views.void_entry, name="finance-entry-void"),
    path("suppliers/", views.suppliers, name="finance-suppliers"),
    path("suppliers/<int:pk>/", views.supplier_detail, name="finance-supplier-detail"),
    path("salaries/", views.salaries, name="finance-salaries"),
    path("salaries/staff/", views.salary_staff, name="finance-salary-staff"),
    path("salaries/<int:pk>/", views.salary_detail, name="finance-salary-detail"),
]
