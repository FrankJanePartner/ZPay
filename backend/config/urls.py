from django.urls import path
from payments import views
from payments.ledger import Balance, Transactions
from payments.docs import documentation_home  # Registers endpoint schema annotations.
urlpatterns = [
    path("api/v1/balance/", Balance.as_view()),
    path("api/v1/transactions/", Transactions.as_view()),
    path("", documentation_home, name="api-docs"),
    path("health/", views.Health.as_view()),
    path("api/v1/auth/register/", views.Register.as_view()),
    path("api/v1/auth/login/", views.Login.as_view()),
    path("api/v1/auth/logout/", views.Logout.as_view()),
    path("api/v1/keys/", views.Keys.as_view()),
    path("api/v1/keys/<uuid:pk>/", views.RevokeKey.as_view()),
    path("api/v1/payment-requests/", views.Payments.as_view()),
    path("api/v1/payment-requests/<uuid:pk>/", views.PaymentDetail.as_view()),
]
