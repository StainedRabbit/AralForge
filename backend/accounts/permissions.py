from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsAdminTeacherOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return request.user and request.user.is_authenticated

        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_admin_teacher
        )


class IsAdminTeacher(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_admin_teacher
        )
