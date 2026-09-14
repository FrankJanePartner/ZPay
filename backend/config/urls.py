from django.urls import path
from payments import views
urlpatterns = [
    path("health/", views.Health.as_view()),
    path("api/v1/auth/register/", views.Register.as_view()),
    path("api/v1/auth/login/", views.Login.as_view()),
    path("api/v1/auth/logout/", views.Logout.as_view()),
    path("api/v1/keys/", views.Keys.as_view()),
    path("api/v1/keys/<uuid:pk>/", views.RevokeKey.as_view()),
    path("api/v1/payment-requests/", views.Payments.as_view()),
    path("api/v1/payment-requests/<uuid:pk>/", views.PaymentDetail.as_view()),
]
